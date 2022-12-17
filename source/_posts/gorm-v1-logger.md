---
title: gorm v1 logger
tags:
  - database
  - orm
abbrlink: 219bf6b1
date: 2022-12-17 10:32:00
---

https://v1.gorm.io/docs/

https://v1.gorm.io/docs/logger.html

> Refer GORM’s default logger for how to customize it

https://github.com/jinzhu/gorm/blob/v1.9.16/logger.go

gorm v1 print log

```golang
func (s *DB) print(v ...interface{}) {
	s.logger.Print(v...)
}

func (s *DB) log(v ...interface{}) {
	if s != nil && s.logMode == detailedLogMode {
		s.print(append([]interface{}{"log", fileWithLineNum()}, v...)...)
	}
}

func (s *DB) slog(sql string, t time.Time, vars ...interface{}) {
	if s.logMode == detailedLogMode {
		s.print("sql", fileWithLineNum(), NowFunc().Sub(t), sql, vars, s.RowsAffected)
	}
}
```

gorm v1 print error

```golang
// AddError add error to the db
func (s *DB) AddError(err error) error {
	if err != nil {
		if err != ErrRecordNotFound {
			if s.logMode == defaultLogMode {
				go s.print("error", fileWithLineNum(), err)
			} else {
				s.log(err)
			}

			errors := Errors(s.GetErrors())
			errors = errors.Add(err)
			if len(errors) > 1 {
				err = errors
			}
		}

		s.Error = err
	}
	return err
}
```

gorm v1 print sql

```golang
// trace print sql log
func (scope *Scope) trace(t time.Time) {
	if len(scope.SQL) > 0 {
		scope.db.slog(scope.SQL, t, scope.SQLVars...)
	}
}
```

因此在打开 gorm v1 LogMode 的时候

```golang
// LogMode set log mode, `true` for detailed logs, `false` for no log, default, will only print error logs
func (s *DB) LogMode(enable bool) *DB {
	if enable {
		s.logMode = detailedLogMode
	} else {
		s.logMode = noLogMode
	}
	return s
}
```

会进入到 `s.print log`, `s.print sql` 的打印逻辑

> https://www.soberkoder.com/go-gorm-logging/

如若需要自定义 gorm v1 logger 可以参考如下代码段

```golang
// GormLogger struct
type GormLogger struct{}

// Print - Log Formatter
func (*GormLogger) Print(v ...interface{}) {
  if v[0] == "sql" {
    log.WithFields(
      log.Fields{
        "module":        "gorm",
        "type":          "sql",
        "rows_returned": v[5],
        "src":           v[1],
        //"values":        v[4],
        "duration":      v[2],
      },
    ).Info(v[3])
  } else {
    log.WithFields(log.Fields{"module": "gorm", "type": "log", "src": v[1]}).Print(v[2:]...)
  }
}
```

另外也可以根据 `duration` 实现客户端的 slow sql 打印