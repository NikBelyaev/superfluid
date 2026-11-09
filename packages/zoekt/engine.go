package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/sourcegraph/zoekt"
	"github.com/sourcegraph/zoekt/index"
	"github.com/sourcegraph/zoekt/query"
	"github.com/sourcegraph/zoekt/search"
)

const fileLimit = 2 * 1024 * 1024

type hit struct {
	Path   string `json:"path"`
	Line   int    `json:"line"`
	Column int    `json:"column"`
	Text   string `json:"text"`
}

type result struct {
	Hits      []hit `json:"hits"`
	Truncated bool  `json:"truncated"`
}

type engine struct {
	root      *os.Root
	directory string
	buildMu   sync.Mutex
	mu        sync.RWMutex
	searcher  zoekt.Streamer
	loaded    string
}

func (e *engine) build(paths []string) error {
	e.buildMu.Lock()
	defer e.buildMu.Unlock()
	if err := os.MkdirAll(e.directory, 0700); err != nil {
		return err
	}
	dir, err := os.MkdirTemp(e.directory, "index-")
	if err != nil {
		return err
	}
	keep := false
	defer func() {
		if !keep {
			os.RemoveAll(dir)
		}
	}()
	builder, err := index.NewBuilder(index.Options{
		IndexDir: dir, RepositoryDescription: zoekt.Repository{Name: "worktree"},
		DisableCTags: true, SizeMax: fileLimit, TrigramMax: 1 << 30,
		Parallelism: 1, ShardMax: 32 * 1024 * 1024,
	})
	if err != nil {
		return err
	}
	for _, name := range paths {
		data, err := e.read(name)
		if err != nil {
			builder.Finish()
			return err
		}
		if data == nil {
			continue
		}
		if err := builder.AddFile(name, data); err != nil {
			builder.Finish()
			return err
		}
	}
	if err := builder.Finish(); err != nil {
		return err
	}
	next, err := search.NewDirectorySearcher(dir)
	if err != nil {
		return err
	}
	e.mu.Lock()
	previous, oldDir := e.searcher, e.loaded
	e.searcher, e.loaded = next, dir
	if previous != nil {
		previous.Close()
	}
	e.mu.Unlock()
	keep = true
	if oldDir != "" {
		os.RemoveAll(oldDir)
	}
	return nil
}

func (e *engine) read(name string) ([]byte, error) {
	if !filepath.IsLocal(name) {
		return nil, fmt.Errorf("search path is outside the worktree")
	}
	f, err := e.root.Open(name)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", name, err)
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > fileLimit {
		return nil, nil
	}
	data, err := io.ReadAll(io.LimitReader(f, fileLimit+1))
	if err != nil {
		return nil, err
	}
	if len(data) > fileLimit || bytes.IndexByte(data, 0) >= 0 || !utf8.Valid(data) {
		return nil, nil
	}
	return data, nil
}

func (e *engine) search(pattern string, exclude []string) (result, error) {
	output := result{Hits: []hit{}}
	if strings.TrimSpace(pattern) == "" {
		return output, nil
	}
	if len(pattern) > 2000 || strings.ContainsAny(pattern, "\r\n") {
		return output, fmt.Errorf("enter a search query on one line")
	}
	e.mu.RLock()
	defer e.mu.RUnlock()
	if e.searcher == nil {
		return output, fmt.Errorf("search index is not ready")
	}
	var q query.Q = &query.Substring{Pattern: pattern, CaseSensitive: true, Content: true}
	if len(exclude) > 0 {
		q = query.NewAnd(q, &query.Not{Child: query.NewFileNameSet(exclude...)})
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	found, err := e.searcher.Search(ctx, q, &zoekt.SearchOptions{
		TotalMaxMatchCount: 100000, ShardMaxMatchCount: 100000,
		MaxDocDisplayCount: 501, MaxMatchDisplayCount: 501,
	})
	if err != nil {
		return output, err
	}
	if found.Crashes > 0 {
		return output, fmt.Errorf("search index could not be read; reopen search to rebuild it")
	}
	for _, file := range found.Files {
		for _, line := range file.LineMatches {
			offset := 0
			if len(line.LineFragments) > 0 {
				offset = int(line.LineFragments[0].LineOffset)
			}
			output.Hits = append(output.Hits, lineHit(file.FileName, line.LineNumber, line.Line, offset, len(pattern)))
			if len(output.Hits) == 501 {
				break
			}
		}
		if len(output.Hits) == 501 {
			break
		}
	}
	output.Truncated = len(output.Hits) > 500 || found.FilesSkipped > 0 || found.MatchCount > 501
	if len(output.Hits) > 500 {
		output.Hits = output.Hits[:500]
	}
	return output, nil
}

func lineHit(path string, number int, line []byte, offset, length int) hit {
	column := 1 + len(utf16.Encode([]rune(string(line[:offset]))))
	text := []rune(strings.TrimRight(string(line), "\r\n"))
	if len(text) > 500 {
		before := min(40, max(0, 500-utf8.RuneCount(line[offset:offset+length])))
		start := max(0, utf8.RuneCount(line[:offset])-before)
		text = text[start:min(len(text), start+500)]
	}
	return hit{path, number, column, string(text)}
}

func (e *engine) close() {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.searcher != nil {
		e.searcher.Close()
	}
	os.RemoveAll(e.directory)
}
