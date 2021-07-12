---
title: golang cli context
tags:
  - golang
  - context
  - cobra
categories: 笔记
---

* https://www.sohamkamani.com/golang/context-cancellation-and-values/
* https://stackoverflow.com/questions/52346262/how-to-call-cancel-when-using-exec-commandcontext-in-a-goroutine

# project structure

```
.
├── cmd
│   └── command.go
├── go.mod
├── go.sum
├── main.go
└── pkg
    └── run
        └── long_run_cli.go

3 directories, 5 files
```

# main.go

```golang
package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"zs/toolkit-cli/cmd"
)

func main() {
	c := make(chan os.Signal, 2)
	signal.Notify(c, syscall.SIGINT, syscall.SIGTERM)

	ctx := context.Background()
	ctx, cancel := context.WithCancel(ctx)

	go func() {
		select {
		case <-c:
			cancel()
		}
	}()

	cmd.Execute(ctx)
}
```

# command.go

```golang
package cmd

import (
	"context"
	"fmt"
	"os"
	"os/exec"

	"github.com/spf13/cobra"

	"zs/toolkit-cli/pkg/run"
)

var rootCmd = &cobra.Command{
	Use:   "long run cli",
	Run: func(cmd *cobra.Command, args []string) {
		cli := run.New()
		err := cli.LongRun(cmd.Context())

		fmt.Printf("cli run err: %v\n", err)
		if exitError, ok := err.(*exec.ExitError); ok {
			fmt.Printf("exit code: %d\n", exitError.ExitCode())
		}
	},
}

func Execute(ctx context.Context) {
	if err := rootCmd.ExecuteContext(ctx); err != nil {
		fmt.Printf("err: %v\n", err)
		os.Exit(1)
	}
}
```

# long_run_cli.go

```golang
package run

import (
	"context"
	"os/exec"
)

type CLI struct {

}

func (cli CLI) LongRun(ctx context.Context) error {
	cmd := exec.CommandContext(ctx, "sleep", "30")
	return cmd.Run()
}

func New() *CLI {
	return &CLI{}
}
```