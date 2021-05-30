---
title: rsync
tags:
  - tools
abbrlink: 485f6ed4
---

# Download

https://rsync.samba.org/

最新版本：`Rsync version 3.2.3 released`

# How rsync works

https://rsync.samba.org/how-rsync-works.html

# Guide

https://download.samba.org/pub/rsync/rsync.html

* `--recursive`: recurse into directories
* `--append`: append data onto shorter files
* `--filter`

```
/usr/local/Cellar/rsync/3.2.3/bin/rsync --verbose --no-whole-file --recursive --append --include='*.log' --include='*/' --exclude='*' --prune-empty-dirs dir1/ dir2/
```

注意 rsync 本地目录的特殊之处

https://superuser.com/questions/234273/why-doest-rsync-use-delta-transfer-for-local-files

> --whole-file, This is the default when both the source and destination are specified as local paths, but only if no batch-writing option is in effect.

# High Availability

https://unix.stackexchange.com/questions/48298/can-rsync-resume-after-being-interrupted
