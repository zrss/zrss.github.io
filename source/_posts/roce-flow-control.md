---
title: roce flow control
tags:
  - roce
abbrlink: 86c16d0a
---

> 个人理解记录

所谓无损, 也就是不丢包; 通过 global pause, pfc, dcqcn 等不断演进的流控/拥塞控制协议, 来保障在丢包之前控制源头降速, 避免丢包

* https://enterprise-support.nvidia.com/s/article/howto-configure-dcqcn--roce-cc--values-for-connectx-4--linux-x
* https://enterprise-support.nvidia.com/s/article/dcqcn-parameters
* https://enterprise-support.nvidia.com/s/article/DCQCN-CC-algorithm

# ifconfig vs ethtool

https://enterprise-support.nvidia.com/s/article/ibdev2netdev

`ibdev2netdev`

执行上述命令可查询得到 *it maps the adapter port to the net device*

对于 infiniband 类型的 link layer, 一般来说上述命令得到的是 ib0 设备, 即 IPoIB 虚拟网卡; 对于 ethernet 类型的 link layer，一般来说上述命令得到的是 ens[xxx] 网卡设备

另外注意到 `ifconfig ens[xxx]` 中显示的 Tx 与 Rx, 实际上与 `ethtool -S ens[xxx]` 中的如下值一致

> https://enterprise-support.nvidia.com/s/article/understanding-mlx5-ethtool-counters

* rx_bytes: Representor only: bytes received, that were handled by the hypervisor. supported from kernel 4.18
* tx_bytes: Representor only: bytes transmitted, that were handled by the hypervisor. supported from kernel 4.18

经过实际测试，在使用 rdma 网卡通信时，上述两值并没有明显的计数增加，而观察到 ethtool counters rx_bytes_phy / tx_bytes_phy 才有与实际流量相当的计数增加。所以可能早期（或者内核？） ifconfig 中获取到的数值，仅是网卡的其中某个计数器，而那个计数器又并不能代表真正的实际情况，所以可能 ifconfig 中的数值会是个误导。我们应使用 `ethtool -S ens[xxx]` 查看 rdma 网卡的统计信息。

> rx_bytes_phy, ConnectX-3 naming : rx_bytes
> 例如在 cx3 网卡时，当前主机安装的 ifconfig，取的的确就是“正确”的；而在 cx4/5/6 网卡，rx_bytes 的物理意义发生了变化，变为了记录 *Representor only: bytes received, that were handled by the hypervisor. supported from kernel 4.18*

# 交换机端口常用查询命令

https://support.huawei.com/enterprise/zh/doc/EDOC1100153180/e4418444

https://www.infoq.cn/article/o3rnxl2trb1gxemmxdoj

egress/ingress port

## 查看是否出现丢包

```
display interface 100GE1/0/1
```

```
    Input:                                                                      
      Unicast:            11657620879,   Multicast:                     695     
      Broadcast:                    0,   Jumbo:                           0     
      Discard:                      0,   Frames:                          0     
      Pause:                        0                                           

      Total Error:                  0                                           
      CRC:                          0,   Giants:                          0     
      Jabbers:                      0,   Fragments:                       0     
      Runts:                        0,   DropEvents:                      0     
      Alignments:                   0,   Symbols:                         0     
      Ignoreds:                     0                                           

    Output:                                                                     
      Unicast:              536390526,   Multicast:                     695     
      Broadcast:                    0,   Jumbo:                           0     
      Discard:                      0,   Buffers Purged:                  0     
      Pause:                 18913700
```

## 上行方向丢包 Input

```
display qos buffer ingress-statistics interface 100GE1/0/1
```

查看入方向统计值

```
Interface                   Dropped        Drop Rate   Drop Time                
                     (Packets/Bytes)        (pps/bps)                           
----------------------------------------------------------------                
100GE1/0/1                         0                0          -                
                                   0                0                           
----------------------------------------------------------------
```

## 下行出现丢包 Output

```
display qos queue statistics interface 100GE1/0/1
```

查看队列统计情况

```
 ----------------------------------------------------------------------------------------------                                           
     4         0                   6             0                   0             0          -                                                                 
       100000000                1092             0                   0             0                                                                            
 ----------------------------------------------------------------------------------------------                                                                 
```

## 查看接口出方向队列的缓存使用情况

```
display qos buffer egress-usage interface 100GE1/0/1
```

可以查看无损队列

```
Egress Buffer Usage (KBytes) on single queue: (Current/Total)                   
*: Dynamic threshold                                                            
------------------------------------------------------------                    
Interface       Queue   Type        Guaranteed        Shared                    

------------------------------------------------------------                    
100GE1/0/1          0   Lossy              0/1          0/5*                    
                    1   Lossy              0/1          0/5*                    
                    2   Lossy              0/1          0/5*                    
                    3   Lossless           0/1       0/10156                    
                    4   Lossy              0/1          0/5*                    
                    5   Lossy              0/1          0/5*                    
                    6   Lossy              0/1          0/5*                    
                    7   Lossy              0/1          0/5*                    
------------------------------------------------------------                    
Lossless Service Pool (cells):  0/0                                             
Lossy    Service Pool (cells):  0/151136                                        
------------------------------------------------------------  
```
