---
title: modelarts python sdk job demo
tags:
  - modelarts
abbrlink: ab66f1ba
date: 2023-05-09 01:15:32
---

```python
from modelarts.session import Session
from modelarts.estimatorV2 import Estimator
from modelarts.train_params import OutputData
from modelarts.train_params import InputData

session = Session(access_key='IY7QQFHWAFOHGWTQBVCT',secret_key='uhvyZJW6iMvKcI5KAW6Fue66YhlD7uI7x3tv7mIW', project_id='0579c838010026732f29c01cc63af839', region_name='cn-north-4')

# list job
# job_list = Estimator.get_job_list(session=session, offset=0, limit=10, sort_by="create_time", order="desc")
# print(job_list)

# create a basic training job
estimator = Estimator(session=session,
                      job_description='This is a basic training job',
                      user_image_url="deep-learning-demo/mpi:3.0.0-cuda10.2", # main container 的容器镜像地址
                      user_command="echo hello-world",  # main container 的启动命令
                      outputs=[OutputData(obs_path="obs://zs-modelarts/pytorch/model/", name="model", local_path="/model", access_method="env")],
                      log_url="obs://zs-modelarts/pytorch/log/", # 训练作业日志转存 obs 路径
                      train_instance_type="modelarts.p3.large.public.free", # 公共资源池
                      train_instance_count=1 # 训练作业节点个数
                      )

job_instance = estimator.fit(job_name="job-0")

# get job id in job_instance
print(job_instance.job_id)

# view the training job log
# estimator = Estimator(session=session, job_id="2bfc13b6-782e-45ad-ae90-476dfa97591a")
# info = estimator.get_job_log()
# print(info)

# view the training job metrics
# estimator = Estimator(session=session, job_id="2bfc13b6-782e-45ad-ae90-476dfa97591a")
# info = estimator.get_job_metrics()
# print(info)

# delete the training job metrics
# Estimator.delete_job_by_id(session=session, job_id="2bfc13b6-782e-45ad-ae90-476dfa97591a")
```
