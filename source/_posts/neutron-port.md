---
title: neutron port
abbrlink: 247bf619
date: 2018-12-01 11:39:53
tags: network
---

# Port

## VIP

查询虚拟 IP，via device_owner=neutron:VIP_PORT

虚拟 IP 绑定的 IP（网卡） allowed_address_pairs

例如 VIP 192.168.186.192

```json
allowed_address_pairs: [
  {
    "ip_address": "192.168.129.104",
    "mac_address": "fa:16:3e:6e:e0:d8"
  },
  {
    "ip_address": "192.168.155.84",
    "mac_address": "fa:16:3e:6e:e0:d8"
  }
]
```

VIP 可手动配置至网卡，例如给 eth0 配置 vip（ip 别名），使得 eth0 存在多个 ip

```bash
ifconfig eth0:1 192.168.0.107 netmask 255.255.0.0
```

亦或者直接添加 ip 至 dev eth0

```bash
ip addr add 192.168.2.105/24 dev eth0
```

常见做法是外部通过 VIP 访问服务，服务使用 Keeplive 组件实现 VIP 在多个后端节点漂移，从而实现服务 HA

## ECS IP

查询 ECS IP（网卡），via device_id

例如 device_id=fe6b212b-9b84-4c0a-8137-528be40f0b04，即 ECS ID

主网卡有如下字段

```json
{
  "primary_interface": true
}
```

VIP 设计为绑定在其他 IP 上，因此其不存在 port_id (网卡 IP)，仅存在自身的 vip_port_id，若 VIP 被多个 IP 绑定，则其对应多个 port_id

openstack 创建 ECS 过程，首先使用 neutron 命令创建 port (主网卡)，其次使用 cinder 命令创建系统盘，最后使用 nova 命令根据主网卡及系统盘创建出 ECS 实例

## ALL IP

查询 ALL IP，via network_id

例如 network_id=8b8457ab-521a-4da0-9cd4-aee1688ee0f8，即 VPC ID

结果包括 ECS IP、VIP 等

## Up / Down

* up 启用 network interface
* down 停用 network interface

# VPC

VPC 访问方案

## VPC Endpoint

优势

* 发布处于 VPC 中的服务，供外部使用

限制

* 服务发布方发布服务后，需将服务标识告知使用方
* 使用方在本 VPC 中，通过创建 VPC Endpoint 以访问服务发布方 VPC 中提供的服务，VPC Endpoint 需消耗 本 VPC 的一个 IP 资源

## VPC Peering

优势

* VPC 全互通

限制

* 对于 VPC Peering 来说，有网段及子网的限制 ，若冲突则无法 Peering
* VPC Peering 仅在主网卡生效，对于多网卡的主机，需额外设置路由规则，使得与 VPC Peering 通信的报文被正确转发至主网卡