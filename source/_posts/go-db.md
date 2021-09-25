---
title: go db connection pool
tags:
  - golang
  - db
abbrlink: '14155322'
---

# https://pkg.go.dev/database/sql/driver

sql/driver 中定义了 db driver 应实现的接口，其中明确了 **ErrBadConn** 的处理方式

> 1. The Connector.Connect and Driver.Open methods should never return ErrBadConn. 
> 1. ErrBadConn should only be returned from Validator, SessionResetter, or a query method if the connection is already in an invalid (e.g. closed) state.
>
> `var ErrBadConn = errors.New("driver: bad connection")`
>
> ErrBadConn should be returned by a driver to signal to the sql package that a driver.Conn is in a bad state (such as the server having earlier closed the connection) and **the sql package** should retry on a new connection.
>
> To prevent duplicate operations, ErrBadConn should NOT be returned if there's a possibility that the database server might have performed the operation. Even if the server sends back an error, you shouldn't return ErrBadConn.

简而言之，当 sql driver 返回 ErrBadConn 错误时，sql package 应使用 new connection 重试

# https://pkg.go.dev/database/sql

golang native db connection pool

connection retry 机制结合 golang native sql Query/Exec 实现理解

> https://github.com/golang/go/issues/11978

```golang
// maxBadConnRetries is the number of maximum retries if the driver returns
// driver.ErrBadConn to signal a broken connection before forcing a new
// connection to be opened.
const maxBadConnRetries = 2

// QueryContext executes a query that returns rows, typically a SELECT.
// The args are for any placeholder parameters in the query.
func (db *DB) QueryContext(ctx context.Context, query string, args ...interface{}) (*Rows, error) {
	var rows *Rows
	var err error
	for i := 0; i < maxBadConnRetries; i++ {
		rows, err = db.query(ctx, query, args, cachedOrNewConn)
		if err != driver.ErrBadConn {
			break
		}
	}
	if err == driver.ErrBadConn {
		return db.query(ctx, query, args, alwaysNewConn)
	}
	return rows, err
}

// Query executes a query that returns rows, typically a SELECT.
// The args are for any placeholder parameters in the query.
func (db *DB) Query(query string, args ...interface{}) (*Rows, error) {
	return db.QueryContext(context.Background(), query, args...)
}
```

Exec 实现

```golang
// ExecContext executes a query without returning any rows.
// The args are for any placeholder parameters in the query.
func (db *DB) ExecContext(ctx context.Context, query string, args ...interface{}) (Result, error) {
	var res Result
	var err error
	for i := 0; i < maxBadConnRetries; i++ {
		res, err = db.exec(ctx, query, args, cachedOrNewConn)
		if err != driver.ErrBadConn {
			break
		}
	}
	if err == driver.ErrBadConn {
		return db.exec(ctx, query, args, alwaysNewConn)
	}
	return res, err
}

// Exec executes a query without returning any rows.
// The args are for any placeholder parameters in the query.
func (db *DB) Exec(query string, args ...interface{}) (Result, error) {
	return db.ExecContext(context.Background(), query, args...)
}
```

综上 ErrBadConn 时，最多重试 2 次，使用 cached conn 或 new conn；超过重试次数，再尝试使用 new conn 1 次

# psql BadConn

https://www.postgresql.org/docs/10/app-psql.html#id-1.9.4.18.7

> 2 if the connection to the server went bad and the session was not interactive
