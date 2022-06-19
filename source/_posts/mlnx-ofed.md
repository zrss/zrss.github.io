---
title: mlnx ofed
tags:
  - docker
  - mlnx
  - ofed
abbrlink: 4c123add
date: 2022-06-19 14:11:00
---

# mlnx cx adapter card firmware

> https://network.nvidia.com/support/firmware/connectx4ib/

* 12.28.2006 -- newer, current versions
* 12.28.1002 -- old
* 12.27.4000 -- older

注意到 mlnx ofed Additional Firware Version Supported 一般是前几个 firmware 版本中的一个

> https://network.nvidia.com/support/firmware/connectx5ib/

* 16.28.2006 -- newer
* 16.28.1002 -- old

> https://network.nvidia.com/support/firmware/connectx6dx/

* 22.28.2006 -- newer
* 22.28.1002 -- old

# mlnx ofed

容器镜像中安装的 mlnx ofed，与宿主机中安装的 mlnx ofed 有何联系？

其实并无联系，仅仅与宿主机 mlnx 网卡型号，及其 firmware 版本有关系

以 mlnx ofed LTS version 5.4-3.1.0.0 为例，在其 Release Notes 中明确提到了该 ofed 配套的 firmware 版本

> 不同 OS 版本，均指向同一 Release Notes

https://docs.nvidia.com/networking/display/MLNXOFEDv543100/Release+Notes

支持的网卡及其速率

* ConnectX-4
    * Infiniband: ...
    * Ethernet: 100Gb, ...
* ConnectX-5
    * Infiniband: ...
    * Ethernet: 100Gb, ...
* ConnectX-6 Dx
    * Ethernet: 100Gb, ...

https://docs.nvidia.com/networking/display/MLNXOFEDv543100/General+Support#GeneralSupport-SupportedNICFirmwareVersions

> Upgrading MLNX_OFED on a cluster requires upgrading all of its nodes to the newest version as well

> This current version is tested with the following NVIDIA NIC firmware versions

> Firmware versions listed are the minimum supported versions

| NIC | Recommended Firmware Version | Additional Firmware Version Supported |
| --- | --- | --- |
| cx4 | 12.28.2006 | 12.28.2006 |
| cx5 | 16.31.2006 | 16.31.1014 |
| cx6 dx | 22.31.2006 | 22.31.1014 |

该 mlnx ofed 5.4-3.1.0.0 驱动要求的 **最小** firmware 版本，但是注意到 mlnx ofed 从 5.4 版本才开始增加 `minimum supported versions` 的描述

与之相比，mlnx ofed LTS version 4.9-4.1.7.0 驱动要求的 firmware 版本如下

> https://docs.nvidia.com/networking/display/MLNXOFEDv494170/General+Support+in+MLNX_OFED#GeneralSupportinMLNX_OFED-SupportedNICsFirmwareVersions

| NIC | Recommended Firmware Version | Additional Firmware Version Supported |
| --- | --- | --- |
| cx4 | 12.28.2006 | 12.27.4000 |
| cx5 | 16.28.2006 | 16.27.2008 |
| cx6 dx | 22.28.2006 | NA |

# identifying adapter cards

https://network.nvidia.com/support/firmware/identification/

```
ibv_devinfo
```
