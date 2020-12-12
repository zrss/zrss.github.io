---
title: spark-cluster-mode-on-k8s
abbrlink: f68a955a
date:  2019-12-08 10:16:51
tags: MachineLearning
---

https://spark.apache.org/docs/latest/cluster-overview.html

https://spark.apache.org/docs/latest/cluster-overview.html#glossary

https://github.com/GoogleCloudPlatform/spark-on-k8s-operator/blob/master/examples/spark-pi.yaml

https://github.com/GoogleCloudPlatform/spark-on-k8s-operator/blob/master/examples/spark-py-pi.yaml

`KUBERNETES_SERVICE_HOST`

`KUBERNETES_SERVICE_PORT`

```bash
--class=...
--master k8s://https://%s:%s
--deploy-mode cluster/client
--conf spark.kubernetes.namespace=default
--conf spark.app.name=spark-pi
SparkPi.jar (MainApplicationFile: MainFile is the path to a bundled JAR, Python, or R file of the application.)
```

SPARK_HOME/bin/spark-submit args

Spark-on-k8s-operator controller run the `spark-submit` scripts

https://spark.apache.org/docs/2.3.1/running-on-kubernetes.html

https://spark.apache.org/docs/2.3.1/running-on-kubernetes.html#cluster-mode

```bash
$ bin/spark-submit \
    --master k8s://https://<k8s-apiserver-host>:<k8s-apiserver-port> \
    --deploy-mode cluster
    --name spark-pi \
    --class org.apache.spark.examples.SparkPi \
    --conf spark.executor.instances=5 \
    --conf spark.kubernetes.container.image=<spark-image> \
    local:///path/to/examples.jar
```

https://spark.apache.org/docs/2.3.1/running-on-kubernetes.html#dependency-management

client mode is not supported in 2.3.1 (cluster manager)

but it seems work in 2.4

https://spark.apache.org/docs/latest/running-on-kubernetes.html

Dependencies Jars and Files

logs

```bash
kubectl -n=<namespace> logs -f <driver-pod-name>
```

https://github.com/GoogleCloudPlatform/spark-on-k8s-operator/blob/master/docs/design.md
