---
title: angularjs and webpack
abbrlink: 9bd3bd71
date: 2017-12-03 15:58:34
tags:
    - FrontEnd
---

# 前言

最近在给 ETCD cluster on k8s 写 FE (front end)，此篇总结一下框架性的东西

很久之前在实验室的时候，曾经蹚水过一段时间 fe 开发，深知 fe 领域目前 一天涌现 100 个开发工具 的节奏，从 angularjs (google) 到 react (facebook)，都是 SPA (single page application) 的实践

使用这两框架，对于 fe 小白开发来说，最大好处是省去了大部分 jQuery 手工操作 DOM 的繁杂代码，都由框架代为更新 DOM 元素了。当然也引入了比服务器端渲染页面的经典设计模式 MVC (model view controller)，更进一步的 MVVM (model view viewModel) 模式，支持视图到模型，模型到视图的双向数据更新特性。由此 fe 的代码得到极大净化

然而无奈 fe 仍然是个劳动密集型的方向，毕竟是眼见为实，与用户距离最近的东西，一言不合就有需求，就有改动了。因此代码一开始可能是规整的，过了一段时间后，就直接起飞了 …

现实不讨论了，先进入正题

## 找轮子

不重复造轮子，github 上搜索一把，可以得到很多 startup 项目，找一个 star 比较多的，例如 https://github.com/preboot/angularjs-webpack，直接用该项目来开始好了

```bash
git clone https://github.com/preboot/angularjs-webpack.git
```

## 分析轮子

该项目为 node + angularjs + webpack 的一个极简 demo

node 就不说了，fe 的革命，很大程度由 node 引发

angularjs 呢，mvvm 框架

webpack 简单理解的话，在 java / c++ 等语言中，可以通过 include or import 关键字导入依赖的库，进而在当前模块中使用已实现的方法，避免重复的开发工作。那么在 fe 中 import 依赖的组件，如当前模块依赖的 js / css 代码，webpack 的作用就是理解这些 import 指令，最后将所有代码 打包 成可实际执行的代码

## 用轮子造车子

### 项目结构

```
├── LICENSE
├── README.md
├── karma.conf.js
├── node_modules
├── package.json
├── postcss.config.js
├── src
└── webpack.config.js
```

package.json 定义了 node 项目的依赖

通过 npm install 安装 package.json 中定义的依赖到项目下的 node_modules 文件夹下

国内的网络环境一般，需要一些手段加速依赖下载，如淘宝的 npm 镜像站

```bash
# 安装淘宝定义的 cnpm
npm install -g cnpm --registry=https://registry.npm.taobao.org
# 安装项目依赖
cnpm install
```

速度可以说是很快了，秒装

webpack.config.js 为 webpack 的配置文件，其中比较重要的配置有

SPA 应用 js 入口

```javascript
config.entry = isTest ? void 0 : {
  app: './src/app/app.js'
};
```

SPA 应用 page 入口

```javascript
new HtmlWebpackPlugin({
  template: './src/public/index.html',
  inject: 'body'
}),
```

base 路径

```javascript
config.devServer = {
  contentBase: './src/public',
  stats: 'minimal'
};
```

即在该路径下有一文件，如 ./src/public/hello.png，那么在浏览器中 url/hello.png 能访问到

本地开发时 dev server 的访问地址

```
// Output path from the view of the page
// Uses webpack-dev-server in development
publicPath: isProd ? '/' : 'http://localhost:8080/',
```

### 本地开发

```bash
// 启动 webpack dev server
npm start
// 浏览器访问 pulicPath 地址即可，如
// http://localhost:8080/
```

其他的不多说了，此篇质量一般，也是我现在开发 fe 的一个无奈吧，这里增加几句话，那里增加几句话，okay it works，细节不清楚，只是为了完成业务逻辑，当然也因为目前兴趣不在此。详细的可看看 参考 (3)

# 参考

https://github.com/preboot/angularjs-webpack

https://npm.taobao.org/

http://angular-tips.com/blog/2015/06/using-angular-1-dot-x-with-es6-and-webpack/
