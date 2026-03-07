---
title: transparent huge page
abbrlink: 168d7bf9
date: 2024-06-30 12:53:00
---

THP

https://alexandrnikitin.github.io/blog/transparent-hugepages-measuring-the-performance-impact/

增加 page 大小, 从而减少 TLB 大小; 由于 walk TLB 开销较大, 所以是个优化

THP 会让 os 申请连续的内存空间大小, 但如果申请不到, 则 os 会开始 compact, reclaim or page out other pages; 

> That process is expensive and could cause latency spikes (up to seconds)

`cat /proc/buddyinfo`

> Each column represents the number of pages of a certain order which are 
> available.  In this case, there are 0 chunks of 2^0*PAGE_SIZE available in 
> ZONE_DMA, 4 chunks of 2^1*PAGE_SIZE in ZONE_DMA, 101 chunks of 2^4*PAGE_SIZE 
> available in ZONE_NORMAL, etc...

https://andorian.blogspot.com/2014/03/making-sense-of-procbuddyinfo.html

