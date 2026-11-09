package main

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"sync"
)

func (e *engine) scan(ctx context.Context, pattern string, paths, exclude []string) (result, error) {
	output := result{Hits: []hit{}}
	if strings.TrimSpace(pattern) == "" {
		return output, nil
	}
	if len(pattern) > 2000 || strings.ContainsAny(pattern, "\r\n") {
		return output, fmt.Errorf("enter a search query on one line")
	}
	skipped := make(map[string]bool, len(exclude))
	for _, path := range exclude {
		skipped[path] = true
	}
	ctx, cancel := context.WithCancel(ctx)
	jobs := make(chan string)
	type scanned struct {
		hits []hit
		err  error
	}
	matches := make(chan scanned, 4)
	var workers sync.WaitGroup
	for range 4 {
		workers.Go(func() {
			for path := range jobs {
				if ctx.Err() != nil {
					return
				}
				hits, err := e.scanFile(ctx, path, []byte(pattern))
				select {
				case matches <- scanned{hits, err}:
				case <-ctx.Done():
					return
				}
			}
		})
	}
	defer func() { cancel(); workers.Wait() }()
	go func() {
		defer close(jobs)
		for _, path := range paths {
			if skipped[path] {
				continue
			}
			select {
			case jobs <- path:
			case <-ctx.Done():
				return
			}
		}
	}()
	go func() { workers.Wait(); close(matches) }()
	for match := range matches {
		if match.err != nil {
			return output, match.err
		}
		output.Hits = append(output.Hits, match.hits...)
		if len(output.Hits) > 500 {
			output.Hits = output.Hits[:500]
			output.Truncated = true
			return output, nil
		}
	}
	return output, ctx.Err()
}

func (e *engine) scanFile(ctx context.Context, path string, needle []byte) ([]hit, error) {
	data, err := e.read(path)
	if err != nil {
		return nil, err
	}
	if !bytes.Contains(data, needle) {
		return nil, nil
	}
	hits := []hit{}
	for from, number := 0, 1; from < len(data); number++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		end := bytes.IndexByte(data[from:], '\n')
		if end < 0 {
			end = len(data) - from
		}
		line := data[from : from+end]
		if offset := bytes.Index(line, needle); offset >= 0 {
			hits = append(hits, lineHit(path, number, line, offset, len(needle)))
			if len(hits) > 500 {
				break
			}
		}
		from += end + 1
	}
	return hits, nil
}
