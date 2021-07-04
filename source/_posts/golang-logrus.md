---
title: golang logrus
tags:
  - golang
  - log
categories: 笔记
abbrlink: cd7f3948
---

# log output format sample

```
INFO[2021-07-04 15:26:26]main.go:28 have a nice day                               zs=log
INFO[2021-07-04 15:26:26]main.go:29 zs gogogo                                     zs=log
```

# code sample

show timestamp

* https://github.com/Sirupsen/logrus/issues/415

the meaning of [0000]

* https://github.com/Sirupsen/logrus/issues/163

add common prefix

* https://github.com/sirupsen/logrus/issues/773
* https://github.com/sirupsen/logrus#default-fields

have a little overhead, add filename and line number

* https://github.com/sirupsen/logrus/issues/63#issuecomment-548792922 
* https://github.com/sirupsen/logrus#logging-method-name
* https://github.com/sirupsen/logrus/blob/master/example_custom_caller_test.go 

```golang
package main

import (
	"path"
	"runtime"
	"strconv"

	"github.com/sirupsen/logrus"
)

func main() {
	var log = logrus.New()

	formatter := &logrus.TextFormatter{
		FullTimestamp:   true,
		TimestampFormat: "2006-01-02 15:04:05",
		CallerPrettyfier: func(f *runtime.Frame) (string, string) {
			_, filename := path.Split(f.File)
			// do not log func name
			return "", filename + ":" + strconv.Itoa(f.Line)
		},
	}
	log.SetFormatter(formatter)
	log.SetReportCaller(true)

	contextLogger := log.WithField("zs", "log")

	contextLogger.Info("have a nice day")
	contextLogger.Infof("%s gogogo", "zs")
}
```

# third-party formatter

https://github.com/sirupsen/logrus#formatters

* https://github.com/x-cray/logrus-prefixed-formatter

## log output format sample

```
[2021-07-04 15:50:26]  INFO log: have a nice day
[2021-07-04 15:50:26]  INFO log: zs gogogo
```

## code sample

```
package main

import (
	"github.com/sirupsen/logrus"
	prefixed "github.com/x-cray/logrus-prefixed-formatter"
)

func main() {
	var log = logrus.New()

	formatter := &prefixed.TextFormatter{
		FullTimestamp:   true,
		TimestampFormat: "2006-01-02 15:04:05",
	}
	log.Formatter = formatter

	contextLogger := log.WithField("prefix", "log")

	contextLogger.Info("have a nice day")
	contextLogger.Infof("%s gogogo", "zs")
}
```

as previous code show

```
contextLogger := log.WithField("prefix", "log")
```

u can prefix a *log* key and colon before the msg output
