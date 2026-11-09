package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestIndexLiteralSearchAndReplacement(t *testing.T) {
	path := t.TempDir()
	root, err := os.OpenRoot(path)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	e := engine{root: root, directory: t.TempDir()}
	defer e.close()
	write := func(name, text string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(path, name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	write("main.py", "😀 Literal[a] Literal[a]\r\n"+strings.Repeat("Literal[a]\n", 510))
	write("other.py", "Literal[a]\n")
	if err := e.build([]string{"main.py", "other.py"}); err != nil {
		t.Fatal(err)
	}
	found, err := e.search("Literal[a]", []string{"main.py"})
	if err != nil {
		t.Fatal(err)
	}
	if len(found.Hits) != 1 || found.Hits[0].Path != "other.py" || found.Truncated {
		t.Fatalf("unexpected exclusion: %+v", found)
	}
	found, err = e.search("😀 Literal[a]", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(found.Hits) != 1 || found.Hits[0].Line != 1 || found.Hits[0].Column != 1 {
		t.Fatalf("unexpected unicode position: %+v", found)
	}
	found, err = e.search("Literal[a]", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(found.Hits) != 500 || !found.Truncated {
		t.Fatalf("unbounded output: %+v", found)
	}
	for _, h := range found.Hits {
		if h.Line == 1 && h.Path == "main.py" && h.Column != 4 {
			t.Fatalf("expected UTF-16 column 4: %+v", h)
		}
	}
	if err := e.build([]string{"../outside.py"}); err == nil {
		t.Fatal("accepted traversal")
	}
	found, err = e.search("Literal[a]", []string{"main.py"})
	if err != nil || len(found.Hits) != 1 {
		t.Fatalf("failed rebuild destroyed index: %+v %v", found, err)
	}
	write("other.py", "updated\n")
	if err := e.build([]string{"other.py"}); err != nil {
		t.Fatal(err)
	}
	found, err = e.search("Literal[a]", nil)
	if err != nil || len(found.Hits) != 0 {
		t.Fatalf("replacement retained old files: %+v %v", found, err)
	}
	entries, err := os.ReadDir(e.directory)
	if err != nil || len(entries) != 1 {
		t.Fatalf("old indexes were not reclaimed: %v %v", entries, err)
	}
}

func TestWorktreeFilesRespectNestedIgnoresAndBoundaries(t *testing.T) {
	path := t.TempDir()
	write := func(name, text string) {
		t.Helper()
		file := filepath.Join(path, name)
		if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	write(".git", "gitdir: outside")
	write(".gitignore", "*.tmp\n!keep.tmp\nskip/\n/root-only.py\nnested/deep?.py\n")
	write(".ignore", "generated/\n")
	for _, name := range []string{"visible.py", "keep.tmp", "drop.tmp", "root-only.py", "skip/private.py", "generated/private.py", "nested/root-only.py", "nested/nested.tmp", "nested/deep1.py", ".venv/private.py", ".worktrees/other/private.py", "venv_helpers.py"} {
		write(name, "content")
	}
	write("nested/.gitignore", "!nested.tmp\n")
	if err := os.Symlink(t.TempDir(), filepath.Join(path, "external")); err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(path)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	e := engine{root: root}
	paths, err := e.files()
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	for _, name := range paths {
		found[name] = true
	}
	for _, name := range []string{"visible.py", "keep.tmp", "nested/root-only.py", "nested/nested.tmp", "venv_helpers.py"} {
		if !found[name] {
			t.Fatalf("missing included file %s: %v", name, paths)
		}
	}
	for _, name := range []string{".git", "drop.tmp", "root-only.py", "skip/private.py", "generated/private.py", "nested/deep1.py", ".venv/private.py", ".worktrees/other/private.py", "external"} {
		if found[name] {
			t.Fatalf("listed excluded file %s", name)
		}
	}
}
