---
title: Docker container -i -t
tags:
  - docker
categories: 笔记
abbrlink: 52d00230
---

# docker

> https://docs.docker.com/engine/reference/run/#foreground
>
> -t : Allocate a pseudo-tty
> -i : Keep STDIN open even if not attached

`docker run -t`

```shell
docker pull ubuntu:bionic-20200713

docker run -t --rm ubuntu:bionic-20200713 /bin/bash
root@9a7a115ff8d2:/# ls

```

启动容器无 `-i` 参数时，执行 `ls` 等命令无回显，执行 `exit` 命令无法退出 container terminal

`docker run -i`

```shell
docker run -i --rm ubuntu:bionic-20200713 /bin/bash
echo hello
hello
exit
```

启动容器无 `-t` 参数时，缺少常用的 terminal 功能，例如无当前登陆用户提示；但执行 `ls` 等命令正常有回显，且执行 `exit` 命令可退出

> https://stackoverflow.com/questions/48368411/what-is-docker-run-it-flag
>
> Without `-t` tag one can still interact with the container, but with it, you'll have a nicer, more features terminal.

# k8s

https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.24/#container-v1-core

```golang
	// Variables for interactive containers, these have very specialized use-cases (e.g. debugging)
	// and shouldn't be used for general purpose containers.

	// Whether this container should allocate a buffer for stdin in the container runtime. If this
	// is not set, reads from stdin in the container will always result in EOF.
	// Default is false.
	// +optional
	Stdin bool `json:"stdin,omitempty" protobuf:"varint,16,opt,name=stdin"`
	// Whether the container runtime should close the stdin channel after it has been opened by
	// a single attach. When stdin is true the stdin stream will remain open across multiple attach
	// sessions. If stdinOnce is set to true, stdin is opened on container start, is empty until the
	// first client attaches to stdin, and then remains open and accepts data until the client disconnects,
	// at which time stdin is closed and remains closed until the container is restarted. If this
	// flag is false, a container processes that reads from stdin will never receive an EOF.
	// Default is false
	// +optional
	StdinOnce bool `json:"stdinOnce,omitempty" protobuf:"varint,17,opt,name=stdinOnce"`
	// Whether this container should allocate a TTY for itself, also requires 'stdin' to be true.
	// Default is false.
	// +optional
	TTY bool `json:"tty,omitempty" protobuf:"varint,18,opt,name=tty"`
```

```golang
	config := &runtimeapi.ContainerConfig{
		Metadata: &runtimeapi.ContainerMetadata{
			Name:    container.Name,
			Attempt: restartCountUint32,
		},
		Image:       &runtimeapi.ImageSpec{Image: imageRef},
		Command:     command,
		Args:        args,
		WorkingDir:  container.WorkingDir,
		Labels:      newContainerLabels(container, pod),
		Annotations: newContainerAnnotations(container, pod, restartCount, opts),
		Devices:     makeDevices(opts),
		Mounts:      m.makeMounts(opts, container),
		LogPath:     containerLogsPath,
		Stdin:       container.Stdin,
		StdinOnce:   container.StdinOnce,
		Tty:         container.TTY,
	}
```

# use conda env in docker

> https://pythonspeed.com/articles/activate-conda-dockerfile/
>
> https://docs.conda.io/projects/conda/en/latest/commands/run.html

```shell
conda run --no-capture-output -n my-python-env python --version
```
