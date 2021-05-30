---
title: the pod name of volcano job
tags:
  - dl
  - volcano
categories: 笔记
abbrlink: 3ec4a29b
---

https://github.com/volcano-sh/volcano/blob/master/pkg/controllers/job/job_controller_actions.go#L278

```
${vj-job-name}-${task-name}-${index}
```
