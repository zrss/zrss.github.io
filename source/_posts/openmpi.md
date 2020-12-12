---
title: openmpi
abbrlink: 3ac56ec7
date: 2019-06-02 10:36:50
tags: 
    - hpc
    - issues
---

https://github.com/open-mpi/ompi/issues/6691#issuecomment-497245597

ess_hnp_module.c

```c
orte_set_attribute(&transports, ORTE_RML_TRANSPORT_TYPE, ORTE_ATTR_LOCAL, orte_mgmt_transport, OPAL_STRING);
orte_mgmt_conduit = orte_rml.open_conduit(&transports);
orte_set_attribute(&transports, ORTE_RML_TRANSPORT_TYPE, ORTE_ATTR_LOCAL, orte_coll_transport, OPAL_STRING);
orte_coll_conduit = orte_rml.open_conduit(&transports);
```

rml: resource message layer

根据 attr 选择 rtmod, 返回的为 mod 在 array 中的 index

> Open conduit - call each component and see if they can provide a
conduit that can satisfy all these attributes - return the conduit id
(a negative value indicates error)

rml_base_stubs.c

```c
orte_rml_API_open_conduit
```

遍历 active 的 rml mod, 调用各个 rml mod 的 open_conduit, 例如 oob (rml_oob_component.c), 返回 mod 之后，存入 array，返回 array index

```
open_conduit()

orte_get_attribute(attributes, ORTE_RML_TRANSPORT_TYPE, (void**)&comp_attrib, OPAL_STRING)
```

从 attr 里获取 key 值，即 orte_mgmt_transport or orte_coll_transport, 确定是否指定了 oob

继续获取 routed mod

```c
orte_get_attribute(attributes, ORTE_RML_ROUTED_ATTRIB, (void**)&comp_attrib, OPAL_STRING);
```

根据设置的 routed mod (NULL 则按优先级) 分配 routed mod

```c
md->routed = orte_routed.assign_module(comp_attrib);
```

orte_mca_params.c

```
orte_mgmt_transport = "oob" // default

--mca orte_mgmt_transport 

ORTE management messages

orte_coll_transport = "fabric,ethernet" // default

--mca orte_coll_transports

ORTE collectives
```

plm_base_launch_support.c

```c
param = NULL;
if (ORTE_SUCCESS != (rc = orte_regx.nidmap_create(orte_node_pool, &param))) {
    ORTE_ERROR_LOG(rc);
    return rc;
}
if (NULL != orte_node_regex) {
    free(orte_node_regex);
}
orte_node_regex = param;
/* if this is too long, then we'll have to do it with
 * a phone home operation instead */
if (strlen(param) < orte_plm_globals.node_regex_threshold) {
    opal_argv_append(argc, argv, "-"OPAL_MCA_CMD_LINE_ID);
    opal_argv_append(argc, argv, "orte_node_regex");
    opal_argv_append(argc, argv, orte_node_regex);
    /* mark that the nidmap has been communicated */
    orte_nidmap_communicated = true;
}
```

orte_node_pool

`node_regex_threshold` = 1024 default len

Resource Allocation Subsystem (RAS)
