package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestUnindexedSearchMatchesIndexAndCancels(t *testing.T) {
	path := t.TempDir()
	for name, text := range map[string]string{
		"main.py": "😀 Literal[a] Literal[a]\r\n",
		"many.py": strings.Repeat("Literal[a]\n", 510),
		"binary":  "Literal[a]\x00",
		"long.md": strings.Repeat("😀", 600) + "LongNeedle",
	} {
		if err := os.WriteFile(filepath.Join(path, name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	root, err := os.OpenRoot(path)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	e := engine{root: root, directory: t.TempDir()}
	defer e.close()
	paths := []string{"main.py", "many.py", "binary", "missing.py", "long.md"}
	found, err := e.scan(context.Background(), "Literal[a]", paths, []string{"many.py"})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(found, result{Hits: []hit{{"main.py", 1, 4, "😀 Literal[a] Literal[a]"}}}) {
		t.Fatalf("unexpected scan: %+v", found)
	}
	if err := e.build(paths); err != nil {
		t.Fatal(err)
	}
	indexed, err := e.search("Literal[a]", []string{"many.py"})
	if err != nil || !reflect.DeepEqual(found, indexed) {
		t.Fatalf("scan and index disagree: %+v %+v %v", found, indexed, err)
	}
	found, err = e.scan(context.Background(), "Literal[a]", paths, nil)
	if err != nil || len(found.Hits) != 500 || !found.Truncated {
		t.Fatalf("unbounded scan: %+v %v", found, err)
	}
	for _, find := range []func() (result, error){
		func() (result, error) { return e.scan(context.Background(), "LongNeedle", paths, nil) },
		func() (result, error) { return e.search("LongNeedle", nil) },
	} {
		long, err := find()
		if err != nil || len(long.Hits) != 1 || long.Hits[0].Column != 1201 || !strings.Contains(long.Hits[0].Text, "LongNeedle") {
			t.Fatalf("match missing from long snippet: %+v %v", long, err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := e.scan(ctx, "Literal[a]", paths, nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("scan ignored cancellation: %v", err)
	}
	if _, err := e.scan(context.Background(), "Literal[a]", []string{"../outside.py"}, nil); err == nil {
		t.Fatal("accepted traversal")
	}
}
