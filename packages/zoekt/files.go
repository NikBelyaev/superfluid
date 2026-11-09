package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	gitignore "github.com/denormal/go-gitignore"
)

func excludedDirectory(name string) bool {
	switch name {
	case ".git", ".worktrees", "node_modules", "__pycache__", ".mypy_cache", ".ruff_cache", ".pytest_cache":
		return true
	}
	return strings.HasPrefix(name, ".venv") || strings.HasPrefix(name, "venv")
}

func (e *engine) files() ([]string, error) {
	paths := []string{}
	bytesUsed := 0
	var walk func(string, []gitignore.GitIgnore) error
	walk = func(directory string, inherited []gitignore.GitIgnore) error {
		folder, err := e.root.Open(directory)
		if os.IsNotExist(err) && directory != "." {
			return nil
		}
		if err != nil {
			return err
		}
		entries, err := folder.ReadDir(-1)
		folder.Close()
		if err != nil {
			return err
		}
		rules := append([]gitignore.GitIgnore{}, inherited...)
		for _, entry := range entries {
			if entry.Name() == "pyvenv.cfg" {
				return nil
			}
		}
		for _, ignoreFile := range []string{".gitignore", ".ignore"} {
			for _, entry := range entries {
				if entry.Name() != ignoreFile || !entry.Type().IsRegular() {
					continue
				}
				data, err := e.read(filepath.Join(directory, ignoreFile))
				if err != nil {
					return err
				}
				if data != nil {
					rules = append(rules, gitignore.New(bytes.NewReader(data), directory, nil))
				}
			}
		}
		for _, entry := range entries {
			if !utf8.ValidString(entry.Name()) || (!entry.IsDir() && !entry.Type().IsRegular()) {
				continue
			}
			if entry.Name() == ".git" {
				continue
			}
			if entry.IsDir() && excludedDirectory(entry.Name()) {
				continue
			}
			path := filepath.Join(directory, entry.Name())
			ignored := false
			for _, rule := range rules {
				rel, err := filepath.Rel(rule.Base(), path)
				if err != nil {
					return err
				}
				if match := rule.Relative(rel, entry.IsDir()); match != nil {
					ignored = match.Ignore()
				}
			}
			if ignored {
				continue
			}
			if entry.IsDir() {
				if err := walk(path, rules); err != nil {
					return err
				}
			} else {
				bytesUsed += len(path) + 1
				if bytesUsed > 16*1024*1024 {
					return fmt.Errorf("worktree file list exceeds 16 MiB; exclude generated folders in .ignore")
				}
				paths = append(paths, filepath.ToSlash(path))
			}
		}
		return nil
	}
	err := walk(".", nil)
	return paths, err
}
