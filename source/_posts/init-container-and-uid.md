---
title: k8s init and sidecar container
tags:
  - k8s
  - design
categories: 笔记
abbrlink: fb311e36
---

{% mermaid graph LR %}
    InitContainer --> TrainingContainer
    InitContainer --> SidecarContainer
{% endmermaid %}

InitContainer and SidecarContainer act like system container and they are transparent to the TrainingContainer

TrainingJob(process) of user is running at TrainingContainer

we can do the init env action at InitContainer, such as download data, and the upload action can be done at SidecarContainer

however, there will be an engineering problem, that is, the file read permission problem. The best way is to make the InitC / SidecarC / TrainingC users (uid) the same

powered by *mermaid*

https://mermaid-js.github.io/mermaid/#/flowchart

https://theme-next.js.org/docs/tag-plugins/mermaid.html?highlight=mermaid

https://github.com/theme-next/hexo-theme-next/pull/649
