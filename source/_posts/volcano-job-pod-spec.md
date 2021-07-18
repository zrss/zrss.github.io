---
title: pod spec of volcano job and sysctl
tags:
  - k8s
  - volcano job
categories: 笔记
abbrlink: d2d36a67
---

# pod spec of volcano job

https://github.com/volcano-sh/volcano/blob/v1.3.0/pkg/controllers/job/job_controller_util.go

```golang
import (
    v1 "k8s.io/api/core/v1"
    ...
)

// MakePodName append podname,jobname,taskName and index and returns the string.
func MakePodName(jobName string, taskName string, index int) string {
	return fmt.Sprintf(jobhelpers.PodNameFmt, jobName, taskName, index)
}

func createJobPod(job *batch.Job, template *v1.PodTemplateSpec, ix int) *v1.Pod {
	templateCopy := template.DeepCopy()

	pod := &v1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      jobhelpers.MakePodName(job.Name, template.Name, ix),
			Namespace: job.Namespace,
			OwnerReferences: []metav1.OwnerReference{
				*metav1.NewControllerRef(job, helpers.JobKind),
			},
			Labels:      templateCopy.Labels,
			Annotations: templateCopy.Annotations,
		},
		Spec: templateCopy.Spec,
	}
    
        ...
}
```

# sysctl of pod spec

https://kubernetes.io/docs/tasks/administer-cluster/sysctl-cluster/

```
apiVersion: v1
kind: Pod
metadata:
  name: sysctl-example
spec:
  securityContext:
    sysctls:
    - name: net.ipv4.ip_local_port_range
      value: "30000 50000"
```

find out current ip local port range

```
cat /proc/sys/net/ipv4/ip_local_port_range
```

https://www.thegeekdiary.com/how-to-reserve-a-port-range-for-a-third-party-application-in-centos-rhel/

> Note: ip_local_port_range and ip_local_reserved_ports settings are independent and both are considered by the kernel when determining which ports are available for **automatic port assignments**.
