---
title: nvml cgo
tags:
  - golang
date: 2023-12-17 19:03:00
abbrlink: da4155d7
---

https://github.com/NVIDIA/go-nvml

> The `nvml.h` file is a direct copy of `nvml.h` from the NVIDIA driver. Since the NVML API is guaranteed to be backwards compatible, we should strive to keep this always up to date with the latest.

https://github.com/xlab/c-for-go.git

golang cgo

https://www.rectcircle.cn/posts/go-static-compile-and-cgo

https://chai2010.cn/advanced-go-programming-book/ch2-cgo/ch2-05-internal.html

poc env, windows11 + wsl2 ubuntu 18.04

```
~/projects/go-nvml ❯ nvidia-smi
Sun Dec 17 18:57:57 2023
+---------------------------------------------------------------------------------------+
| NVIDIA-SMI 545.29.04              Driver Version: 546.17       CUDA Version: 12.3     |
|-----------------------------------------+----------------------+----------------------+
| GPU  Name                 Persistence-M | Bus-Id        Disp.A | Volatile Uncorr. ECC |
| Fan  Temp   Perf          Pwr:Usage/Cap |         Memory-Usage | GPU-Util  Compute M. |
|                                         |                      |               MIG M. |
|=========================================+======================+======================|
|   0  NVIDIA GeForce RTX 3070 Ti     On  | 00000000:06:00.0  On |                  N/A |
|  0%   33C    P8              13W / 290W |   1139MiB /  8192MiB |      1%      Default |
|                                         |                      |                  N/A |
+-----------------------------------------+----------------------+----------------------+

+---------------------------------------------------------------------------------------+
| Processes:                                                                            |
|  GPU   GI   CI        PID   Type   Process name                            GPU Memory |
|        ID   ID                                                             Usage      |
|=======================================================================================|
|    0   N/A  N/A        23      G   /Xwayland                                 N/A      |
+---------------------------------------------------------------------------------------+
```

test code

```golang
package main

import (
	"fmt"
	"log"
	"os"

	"github.com/NVIDIA/go-nvml/pkg/nvml"
)

func getNvidiaDeviceCount() {
	ret := nvml.Init()
	if ret != nvml.SUCCESS {
		log.Fatalf("Unable to initialize NVML: %v", nvml.ErrorString(ret))
	}
	count, ret := nvml.DeviceGetCount()
	if ret != nvml.SUCCESS {
		log.Fatalf("Unable to get device count: %v", nvml.ErrorString(ret))
	}
	fmt.Printf("%d\n", count)
}

func main() {
	args := os.Args
	if len(args) < 2 {
		fmt.Println("hello")
	} else {
		getNvidiaDeviceCount()
	}
}
```

build commands

```bash
export CGO_LDFLAGS="-Wl,-z,now"

go build main.go
./main
./main: symbol lookup error: ./main: undefined symbol: nvmlGpuInstanceGetComputeInstanceProfileInfoV

./main fake
./main: symbol lookup error: ./main: undefined symbol: nvmlGpuInstanceGetComputeInstanceProfileInfoV

# now to lazy
export CGO_LDFLAGS="-Wl,-z,lazy"
go build main.go
./main
hello

./main fake
1

go clean --cache && rm -rf main
go build -work -x main.go
```

go build -x

```shell
cd /root/go/pkg/mod/github.com/!n!v!i!d!i!a/go-nvml@v0.12.0-1/pkg/nvml
TERM='dumb' CGO_LDFLAGS='"-Wl,-z,lazy" "-Wl,--unresolved-symbols=ignore-in-object-files" "-Wl,--unresolved-symbols=ignore-in-object-files"' /root/tools/go/pkg/tool/linux_amd64/cgo -objdir $WORK/b002/ -importpath github.com/NVIDIA/go-nvml/pkg/nvml -- -I $WORK/b002/ -g -O2 -DNVML_NO_UNVERSIONED_FUNC_DEFS=1 -DNVML_NO_UNVERSIONED_FUNC_DEFS=1 ./cgo_helpers.go ./const.go ./init.go ./nvml.go
cd $WORK/b002
TERM='dumb' gcc -I /root/go/pkg/mod/github.com/!n!v!i!d!i!a/go-nvml@v0.12.0-1/pkg/nvml -fPIC -m64 -pthread -fmessage-length=0 -fdebug-prefix-map=$WORK/b002=/tmp/go-build -gno-record-gcc-switches -I ./ -g -O2 -DNVML_NO_UNVERSIONED_FUNC_DEFS=1 -DNVML_NO_UNVERSIONED_FUNC_DEFS=1 -o ./_x001.o -c _cgo_export.c
TERM='dumb' gcc -I /root/go/pkg/mod/github.com/!n!v!i!d!i!a/go-nvml@v0.12.0-1/pkg/nvml -fPIC -m64 -pthread -fmessage-length=0 -fdebug-prefix-map=$WORK/b002=/tmp/go-build -gno-record-gcc-switches -I ./ -g -O2 -DNVML_NO_UNVERSIONED_FUNC_DEFS=1 -DNVML_NO_UNVERSIONED_FUNC_DEFS=1 -o ./_x002.o -c cgo_helpers.cgo2.c
TERM='dumb' gcc -I /root/go/pkg/mod/github.com/!n!v!i!d!i!a/go-nvml@v0.12.0-1/pkg/nvml -fPIC -m64 -pthread -fmessage-length=0 -fdebug-prefix-map=$WORK/b002=/tmp/go-build -gno-record-gcc-switches -I ./ -g -O2 -DNVML_NO_UNVERSIONED_FUNC_DEFS=1 -DNVML_NO_UNVERSIONED_FUNC_DEFS=1 -o ./_x003.o -c const.cgo2.c
TERM='dumb' gcc -I /root/go/pkg/mod/github.com/!n!v!i!d!i!a/go-nvml@v0.12.0-1/pkg/nvml -fPIC -m64 -pthread -fmessage-length=0 -fdebug-prefix-map=$WORK/b002=/tmp/go-build -gno-record-gcc-switches -I ./ -g -O2 -DNVML_NO_UNVERSIONED_FUNC_DEFS=1 -DNVML_NO_UNVERSIONED_FUNC_DEFS=1 -o ./_x004.o -c init.cgo2.c
TERM='dumb' gcc -I /root/go/pkg/mod/github.com/!n!v!i!d!i!a/go-nvml@v0.12.0-1/pkg/nvml -fPIC -m64 -pthread -fmessage-length=0 -fdebug-prefix-map=$WORK/b002=/tmp/go-build -gno-record-gcc-switches -I ./ -g -O2 -DNVML_NO_UNVERSIONED_FUNC_DEFS=1 -DNVML_NO_UNVERSIONED_FUNC_DEFS=1 -o ./_x005.o -c nvml.cgo2.c
TERM='dumb' gcc -I /root/go/pkg/mod/github.com/!n!v!i!d!i!a/go-nvml@v0.12.0-1/pkg/nvml -fPIC -m64 -pthread -fmessage-length=0 -fdebug-prefix-map=$WORK/b002=/tmp/go-build -gno-record-gcc-switches -I ./ -g -O2 -DNVML_NO_UNVERSIONED_FUNC_DEFS=1 -DNVML_NO_UNVERSIONED_FUNC_DEFS=1 -o ./_cgo_main.o -c _cgo_main.c
cd /root/projects/go-nvml
TERM='dumb' gcc -I /root/go/pkg/mod/github.com/!n!v!i!d!i!a/go-nvml@v0.12.0-1/pkg/nvml -fPIC -m64 -pthread -fmessage-length=0 -fdebug-prefix-map=$WORK/b002=/tmp/go-build -gno-record-gcc-switches -o $WORK/b002/_cgo_.o $WORK/b002/_cgo_main.o $WORK/b002/_x001.o $WORK/b002/_x002.o $WORK/b002/_x003.o $WORK/b002/_x004.o $WORK/b002/_x005.o -Wl,-z,lazy -Wl,--unresolved-symbols=ignore-in-object-files -Wl,--unresolved-symbols=ignore-in-object-files
TERM='dumb' /root/tools/go/pkg/tool/linux_amd64/cgo -dynpackage nvml -dynimport $WORK/b002/_cgo_.o -dynout $WORK/b002/_cgo_import.go
```

1. /tmp/go-build2475505462/b002/nvml.cgo1.go
2. /tmp/go-build2475505462/b002/nvml.cgo2.c

```c
CGO_NO_SANITIZE_THREAD
void
_cgo_c813f6172e91_Cfunc_nvmlGpuInstanceGetComputeInstanceProfileInfoV(void *v)
{
        struct {
                nvmlGpuInstance_t p0;
                unsigned int p1;
                unsigned int p2;
                nvmlComputeInstanceProfileInfo_v2_t* p3;
                nvmlReturn_t r;
                char __pad28[4];
        } __attribute__((__packed__, __gcc_struct__)) *_cgo_a = v;
        char *_cgo_stktop = _cgo_topofstack();
        __typeof__(_cgo_a->r) _cgo_r;
        _cgo_tsan_acquire();
        _cgo_r = nvmlGpuInstanceGetComputeInstanceProfileInfoV(_cgo_a->p0, _cgo_a->p1, _cgo_a->p2, _cgo_a->p3);
        _cgo_tsan_release();
        _cgo_a = (void*)((char*)_cgo_a + (_cgo_topofstack() - _cgo_stktop));
        _cgo_a->r = _cgo_r;
        _cgo_msan_write(&_cgo_a->r, sizeof(_cgo_a->r));
}
```

ChatGPT 3.5

-Wl,-z,lazy, -Wl,-z,now

> **-Wl,-z,lazy**: The -Wl,-z,lazy flag in the gcc command is a linker option used to instruct the linker to utilize lazy binding for dynamic libraries during the linking process.
> When a program uses shared libraries (dynamic libraries), such as .so files in Linux, the linking process involves resolving symbols (functions or global variables) from these libraries. Lazy binding delays the resolution of these symbols until they are actually referenced during the program's execution, rather than resolving all symbols at startup.
> Lazy binding delays the resolution of these symbols until they are actually referenced during the program's execution, rather than resolving all symbols at startup.
>
> **-Wl,-z,now**: When you compile a program using gcc with the -Wl,-z,now flag, it influences how the dynamic linker behaves at runtime, particularly when the program is executed and loaded into memory. This flag impacts the linking stage, ensuring that symbols from shared libraries are resolved and bound immediately during the linking phase.
> During the binary's execution, when shared libraries are loaded, immediate binding might help in reducing the overhead associated with symbol resolution at runtime because the symbols are already resolved and bound during the linking process.
> In summary, the -Wl,-z,now flag influences the behavior of the linker while creating the binary, affecting how symbol resolution occurs when the binary is loaded and executed, potentially impacting the startup performance by pre-resolving symbols.
