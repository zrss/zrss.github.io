---
title: conda activate
tags:
  - conda
abbrlink: 467ab0db
date: 2022-04-06 20:42:00
---

> * conda 4.12.0
> * macOS 10.15.7

示例为个人 PC 环境下的回显

> Conda makes environments first-class citizens, making it easy to create independent environments even for C libraries. Conda is written entirely in Python

```bash
# conda environments:
#
base                     /Users/huangzhesi/miniconda
conda-dev             *  /Users/huangzhesi/miniconda/envs/conda-dev
pandas                   /Users/huangzhesi/miniconda/envs/pandas
pytorch-1.8              /Users/huangzhesi/miniconda/envs/pytorch-1.8
pytorch-dev              /Users/huangzhesi/miniconda/envs/pytorch-dev
tensorflow-1.x           /Users/huangzhesi/miniconda/envs/tensorflow-1.x
```

今天来探索下我们输入 `conda activate conda-dev` 命令后，实际上 conda 为了我们做什么

先说结论

1. 设置了 conda env bin 到环境变量 PATH（替换 *old* conda env 值，比如 base conda env）
1. 未修改环境变量 `LD_LIBRARY_PATH`，原因如下

> https://docs.conda.io/projects/conda-build/en/latest/resources/use-shared-libraries.html#shared-libraries-in-macos-and-linux
>
> https://conda.io/projects/conda-build/en/latest/concepts/recipe.html#prefix-replacement
>
> https://github.com/conda/conda/issues/308#issuecomment-36058087
>
> the problem with activate setting LD_LIBRARY_PATH (even when conda packages themselves don't need it) is that it might break other things on the users system.

# 源码

https://github.com/conda/conda/tree/4.12.0

`conda activate` 命令在 conda/activate.py 文件里边实现

调用顺序如下

1. activate
1. build_activate
1. _build_activate_stack

最终返回一个 structure

```python
        return {
            'unset_vars': unset_vars,
            'set_vars': set_vars,
            'export_vars': export_vars,
            'deactivate_scripts': deactivate_scripts,
            'activate_scripts': activate_scripts,
        }
```

可见 `conda activate` 命令实际上会 `unset`，`set`，`export` vars，以达到激活环境的效果

# 激活流程

## 查询 conda env path

```python
    def conda_prefix(self):
        return abspath(sys.prefix)
```

`root_prefix` case = `conda_prefix` = `/Users/huangzhesi/miniconda`

prefix magic file = `{conda_prefix}/conda-meta/history`

```python
# path is the prefix magic file
        if isfile(path):
            try:
                fh = open(path, 'a+')
```

测试 history file 是否有读写权限

```bash
ls -alh /Users/huangzhesi/miniconda/conda-meta | grep history
-rw-r--r--    1 huangzhesi  staff   8.2K 12 19 21:44 history
```

(1) 假若 history file 有读写权限，则 context envs dirs 按如下顺序

1. `/Users/huangzhesi/miniconda/envs`
1. `~/.conda/envs`

(2) 若 history file 没有读写权限，则 context envs dirs 按如下顺序

1. `~/.conda/envs`
1. `/Users/huangzhesi/miniconda/envs`

从 context envs dirs 中查询待激活的 env

```python
# name is the conda activate {name}
    for envs_dir in envs_dirs:
        if not isdir(envs_dir):
            continue
        prefix = join(envs_dir, name)
        if isdir(prefix):
            return abspath(prefix)
```

到这里 prefix 就确定了 `prefix = locate_prefix_by_name(env_name_or_prefix)`

`prefix = /Users/huangzhesi/miniconda/envs/conda-dev`

* CONDA_SHLVL=1
* CONDA_PREFIX=/Users/huangzhesi/miniconda

替换 `old_conda_prefix`，比如 base conda env

```python
                new_path = self.pathsep_join(
                    self._replace_prefix_in_path(old_conda_prefix, prefix))
```

需要设置的环境变量

```python
                env_vars_to_export = OrderedDict((
                    ('path', new_path),
                    ('conda_prefix', prefix),
                    ('conda_shlvl', new_conda_shlvl),
                    ('conda_default_env', conda_default_env),
                    ('conda_prompt_modifier', conda_prompt_modifier)))
```

# set ld_library_path inside python

https://stackoverflow.com/questions/6543847/setting-ld-library-path-from-inside-python

https://stackoverflow.com/questions/856116/changing-ld-library-path-at-runtime-for-ctypes

比较 hack，不优雅 ...

如果 conda env 中安装的非 conda package，其依赖 shared libraries，没太好办法，手动设置 `LD_LIBRARY_PATH` 环境变量吧
