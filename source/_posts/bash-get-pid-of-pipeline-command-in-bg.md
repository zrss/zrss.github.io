---
title: get pid of pipeline command in background
tags:
  - bash
  - pipeline
categories: 笔记
abbrlink: 7cb1245f
---

# get exit code of pipeline command in background

https://stackoverflow.com/questions/37257668/get-exit-code-of-a-piped-background-process

https://stackoverflow.com/questions/35842600/tee-resets-exit-status-is-always-0

```shell
someCommand="python test.py"

{
  ${someCommand} 2>&1 | tee -a training.log
  exit ${PIPESTATUS[0]}
} &

wait $!
echo $?
```

回显

```
127
```

综上 wait 即使指定的是 pid，然而内部代码实现依然会 wait pid 对应的 job，这点 wait 的文档里边说的比较隐晦

https://www.gnu.org/software/bash/manual/html_node/Job-Control-Builtins.html

> Wait until the child process specified by each process ID pid or job specification jobspec exits and return the exit status of the last command waited for.

注意 **return the exit status of the last command waited for**

所以上述代码，wait 命令实际上获取到的是 tee 命令的退出码

在 shell 中获取 pipeline command status 的简易方法似乎只能通过 `${PIPESTATUS[0]}`

# get pid of pipeline command in background

进一步的，我们想获取 someCommand 的 pid，有办法么，尝试做如下改造

```shell
someCommand="python test.py"

{
    ${someCommand} 2>&1 &
    pid_someCommand=$!
    wait ${pid_someCommand}
    exit $?
} | tee -a training.log &

wait $!
echo ${PIPESTATUS[0]}
```

回显

```
0
```

but not work

最后只能使用 `ps -ef | grep someCommand` 的终极大法，加上通过 subshell pid 作为 parent id 过滤

```shell
someCommand="python test.py"

{
  ${someCommand} 2>&1 | tee -a training.log
  exit ${PIPESTATUS[0]}
} &
someCommand_job_pid=$!

someCommand_pid=`ps -efj | awk -v parent_pid=${someCommand_job_pid} '$3==parent_pid { print $0 }' | grep "${someCommand}" | awk '{ print $2 }'`
echo someCommand_pid ${someCommand_pid}

wait ${someCommand_job_pid}
echo $?
```

回显

```
someCommand_pid 55863
127
```

# test.py

```python
import time
import sys

time.sleep(5)
sys.exit(127)
```