---
title: ib_write_bw failed
tags:
  - Infiniband
categories: 笔记
abbrlink: fca75258
date: 2020-11-20 20:00:00
---

https://github.com/linux-rdma/perftest/blob/master/src/write_bw.c

main

```c
user_param.verb = WRITE;
user_param.tst = BW;
```

parser

```
-c, --connection=<RC/XRC/UC/DC> Connection type RC/XRC/UC/DC (default RC)
-s, --size=<size> Size of message to exchange (default 65536)
```

init_perftest_params

```c
...

#define DEF_SIZE_BW   (65536)
#define DEF_SIZE_LAT  (2)
#define DEF_CACHE_LINE_SIZE (64)
#define DEF_PAGE_SIZE (4096)
#define DEF_FLOWS (1)

...

user_param->size = (user_param->tst == BW ) ? DEF_SIZE_BW : DEF_SIZE_LAT;

user_param->connection_type	= (user_param->connection_type == RawEth) ? RawEth : RC;

...

user_param->cache_line_size	= get_cache_line_size();
user_param->cycle_buffer = sysconf(_SC_PAGESIZE);

if (user_param->cycle_buffer <= 0) {
    user_param->cycle_buffer = DEF_PAGE_SIZE;
}

...

user_param->flows = DEF_FLOWS;
```

`get_cache_line_size()`

```c
	int size = 0;
 #if !defined(__FreeBSD__)
	size = sysconf(_SC_LEVEL1_DCACHE_LINESIZE);
	if (size == 0) {
		#if defined(__sparc__) && defined(__arch64__)
		char* file_name =
			"/sys/devices/system/cpu/cpu0/l2_cache_line_size";
		#else
		char* file_name =
			"/sys/devices/system/cpu/cpu0/cache/index0/coherency_line_size";
		#endif

		FILE *fp;
		char line[10];
		fp = fopen(file_name, "r");
		if (fp == NULL) {
			return DEF_CACHE_LINE_SIZE;
		}
		if(fgets(line,10,fp) != NULL) {
			size = atoi(line);
			fclose(fp);
		}
	}
#endif
	if (size <= 0)
		size = DEF_CACHE_LINE_SIZE;
```

`getconf LEVEL1_DCACHE_LINESIZE`


main -> alloc_ctx

```c
ctx->size = user_param->size;

num_of_qps_factor = (user_param->mr_per_qp) ? 1 : user_param->num_of_qps;

/* holds the size of maximum between msg size and cycle buffer,
* aligned to cache line,
* it is multiply by 2 for send and receive
* with reference to number of flows and number of QPs */
ctx->buff_size = INC(BUFF_SIZE(ctx->size, ctx->cycle_buffer),
				 ctx->cache_line_size) * 2 * num_of_qps_factor * user_param->flows;
```

65536 = 64Kb

generally, 16 pages

root cause: ulimit -l is 16 (default) in container
