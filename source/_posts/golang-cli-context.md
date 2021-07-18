---
title: golang cli context
tags:
  - golang
  - context
  - cobra
categories: 笔记
abbrlink: e9a26fdf
---

* https://www.sohamkamani.com/golang/context-cancellation-and-values/
* https://stackoverflow.com/questions/52346262/how-to-call-cancel-when-using-exec-commandcontext-in-a-goroutine

> https://blog.golang.org/context#:~:text=A%20Context%20is%20safe%20for,to%20signal%20all%20of%20them.
>
> A Context is safe for simultaneous use by multiple goroutines. Code can pass a single Context to any number of goroutines and cancel that Context to signal all of them.

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

		if err != nil {
			fmt.Printf("cli run err: %v\n", err)
			if exitError, ok := err.(*exec.ExitError); ok {
				fmt.Printf("exit code: %d\n", exitError.ExitCode())
			}
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

https://pkg.go.dev/os/exec#CommandContext

> The provided context is used to kill the process (by calling os.Process.Kill) if the context becomes done before the command completes on its own.

https://github.com/golang/go/issues/21135

> proposal: os/exec: allow user of CommandContext to specify the kill signal when context is done

commandContext will trigger SIGKILL when the ctx is done ...
