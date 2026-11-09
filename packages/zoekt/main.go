package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sync"
)

type request struct {
	ID      int      `json:"id"`
	Method  string   `json:"method"`
	Paths   []string `json:"paths"`
	Exclude []string `json:"exclude"`
	Query   string   `json:"query"`
	Target  int      `json:"target"`
}

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "Usage: zoekt ROOT INDEX_DIRECTORY")
		os.Exit(1)
	}
	root, err := os.OpenRoot(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer root.Close()
	e := engine{root: root, directory: os.Args[2]}
	defer e.close()
	var output sync.Mutex
	var pending sync.WaitGroup
	var cancellations sync.Map
	slots := make(chan struct{}, 4)
	reader := bufio.NewScanner(os.Stdin)
	reader.Buffer(make([]byte, 4096), 16*1024*1024)
	for reader.Scan() {
		var input request
		if err := json.Unmarshal(reader.Bytes(), &input); err != nil {
			fmt.Fprintln(os.Stderr, err)
			return
		}
		if input.Method == "cancel" {
			if cancel, ok := cancellations.Load(input.Target); ok {
				cancel.(context.CancelFunc)()
			}
			continue
		}
		slots <- struct{}{}
		ctx, cancel := context.WithCancel(context.Background())
		cancellations.Store(input.ID, cancel)
		pending.Go(func() {
			defer func() { <-slots }()
			defer cancel()
			defer cancellations.Delete(input.ID)
			var value any
			var err error
			switch input.Method {
			case "files":
				value, err = e.files()
			case "index":
				err = e.build(input.Paths)
			case "search":
				value, err = e.search(input.Query, input.Exclude)
			case "scan":
				value, err = e.scan(ctx, input.Query, input.Paths, input.Exclude)
			default:
				err = fmt.Errorf("unknown search operation")
			}
			response := map[string]any{"id": input.ID, "value": value}
			if err != nil {
				response["error"] = err.Error()
			}
			output.Lock()
			defer output.Unlock()
			if err := json.NewEncoder(os.Stdout).Encode(response); err != nil {
				fmt.Fprintln(os.Stderr, err)
			}
		})
	}
	pending.Wait()
	if err := reader.Err(); err != nil {
		fmt.Fprintln(os.Stderr, err)
	}
}
