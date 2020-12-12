---
title: k8s annotation of storage
abbrlink: b40cf9b
date: 2018-06-24 12:06:44
tags:
    - k8s
---

> k8s 1.7.6
>
> kubernetes/pkg/controller/volume/persistentvolume/pv_controller.go

claim.Spec.VolumeName == nil 时

storage-controller 会从已有的 volume 中查找符合该 claim 的 volume，如果没找到该 volume，则从 claim 的 annotation 中获取 volume.beta.kubernetes.io/storage-class 字段 / 或从 Spec.StorageClassName 获取 storage-class 的值

* volume.beta.kubernetes.io/storage-class
* Spec.StorageClassName

在允许动态提供存储（enableDynamicProvisioning）的情况下，尝试去提供一个 volume

```go
newClaim, err := ctrl.setClaimProvisioner(claim, storageClass)
```

动态的 pvc 会增加如下 annotation

```go
volume.beta.kubernetes.io/storage-provisioner: class.Provisioner
pv.kubernetes.io/bound-by-controller: yes
pv.kubernetes.io/provisioned-by: plugin.GetPluginName()
```

从存储提供服务获取 volume 的过程是异步的，当获取完成时，设置如下 annotation

```go
pv.kubernetes.io/bind-completed: yes
```

如果是其他可以直接 bind 的情况，在 bind 的方法中也会设置上述 annotation

所以可以通过 pvc annotation

* pv.kubernetes.io/bound-by-controller: yes

确认该 pvc 为动态创建还是直接使用

不过该字段还有一种情况下可能被设置

```go
if volume.Spec.ClaimRef == nil {
    return false
}
if claim.Name != volume.Spec.ClaimRef.Name || claim.Namespace != volume.Spec.ClaimRef.Namespace {
    return false
}
if volume.Spec.ClaimRef.UID != "" && claim.UID != volume.Spec.ClaimRef.UID {
    return false
}
```

volume 和 claim binding 时，发现 volume 与 claim 的字段不匹配

```go
// Check if the claim was already bound (either by controller or by user)
shouldBind := false
if volume.Name != claim.Spec.VolumeName {
    shouldBind = true
}
```

clain 和 volume binding 时，也会出现这种情况，当 volume 与 claim 的字段不匹配时

目前实践经验不足，还不是特别明白这是什么情况下才会出现的，使用 pv.kubernetes.io/bound-by-controller: yes 判断动态创建是否准确?
