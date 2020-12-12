---
title: docker image tar archieve
abbrlink: 1d091a1a
date: 2018-11-17 14:02:27
tags: docker
---

简析 crane pull image 过程

详细过程在内网写了，粗略过程罗列于此

以 docker hub registry 为例

以 crane 二进制工具为参考

https://github.com/google/go-containerregistry/blob/master/cmd/crane/doc/crane.md

google 的同事真是为世界造轮子，many thanks

# Target

从 registry 下载 nginx:latest 镜像

```
docker pull nginx:latest
```

# Auth

https://docs.docker.com/registry/spec/auth/token/#requesting-a-token

1. ping registry

```bash
curl -i https://registry.hub.docker.com/v2/
HTTP/1.1 401 Unauthorized
Content-Type: application/json; charset=utf-8
Docker-Distribution-Api-Version: registry/2.0
Www-Authenticate: Bearer realm="https://auth.docker.io/token",service="registry.docker.io"
Date: Sat, 17 Nov 2018 01:27:49 GMT
Content-Length: 87
Strict-Transport-Security: max-age=31536000
```

在 Www-Authenticate 请求头中可见 Registry 使用 Bearer 认证方式

2. refresh docker auth

```
curl "https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/nginx:pull" | python -mjson.tool
{
    "token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsIng1YyI6WyJNSUlDK2pDQ0FwK2dBd0lCQWdJQkFEQUtCZ2dxaGtqT1BRUURBakJHTVVRd1FnWURWUVFERXpzeVYwNVpPbFZMUzFJNlJFMUVVanBTU1U5Rk9reEhOa0U2UTFWWVZEcE5SbFZNT2tZelNFVTZOVkF5VlRwTFNqTkdPa05CTmxrNlNrbEVVVEFlRncweE9EQXlNVFF5TXpBMk5EZGFGdzB4T1RBeU1UUXlNekEyTkRkYU1FWXhSREJDQmdOVkJBTVRPMVpCUTFZNk5VNWFNenBNTkZSWk9sQlFTbGc2VWsxQlZEcEdWalpQT2xZMU1sTTZRa2szV2pwU1REVk9PbGhXVDBJNlFsTmFSanBHVTFRMk1JSUJJakFOQmdrcWhraUc5dzBCQVFFRkFBT0NBUThBTUlJQkNnS0NBUUVBMGtyTmgyZWxESnVvYjVERWd5Wi9oZ3l1ZlpxNHo0OXdvNStGRnFRK3VPTGNCMDRyc3N4cnVNdm1aSzJZQ0RSRVRERU9xNW5keEVMMHNaTE51UXRMSlNRdFY1YUhlY2dQVFRkeVJHUTl2aURPWGlqNFBocE40R0N0eFV6YTNKWlNDZC9qbm1YbmtUeDViOElUWXBCZzg2TGNUdmMyRFVUV2tHNy91UThrVjVPNFFxNlZKY05TUWRId1B2Mmp4YWRZa3hBMnhaaWNvRFNFQlpjWGRneUFCRWI2YkRnUzV3QjdtYjRRVXBuM3FXRnRqdCttKzBsdDZOR3hvenNOSFJHd3EwakpqNWtZbWFnWHpEQm5NQ3l5eDFBWFpkMHBNaUlPSjhsaDhRQ09GMStsMkVuV1U1K0thaTZKYVNEOFZJc2VrRzB3YXd4T1dER3U0YzYreE1XYUx3SURBUUFCbzRHeU1JR3ZNQTRHQTFVZER3RUIvd1FFQXdJSGdEQVBCZ05WSFNVRUNEQUdCZ1JWSFNVQU1FUUdBMVVkRGdROUJEdFdRVU5XT2pWT1dqTTZURFJVV1RwUVVFcFlPbEpOUVZRNlJsWTJUenBXTlRKVE9rSkpOMW82VWt3MVRqcFlWazlDT2tKVFdrWTZSbE5VTmpCR0JnTlZIU01FUHpBOWdEc3lWMDVaT2xWTFMxSTZSRTFFVWpwU1NVOUZPa3hITmtFNlExVllWRHBOUmxWTU9rWXpTRVU2TlZBeVZUcExTak5HT2tOQk5sazZTa2xFVVRBS0JnZ3Foa2pPUFFRREFnTkpBREJHQWlFQWdZTWF3Si9uMXM0dDlva0VhRjh2aGVkeURzbERObWNyTHNRNldmWTFmRTRDSVFEbzNWazJXcndiSjNmU1dwZEVjT3hNazZ1ZEFwK2c1Nkd6TjlRSGFNeVZ1QT09Il19.eyJhY2Nlc3MiOlt7InR5cGUiOiJyZXBvc2l0b3J5IiwibmFtZSI6ImxpYnJhcnkvbmdpbngiLCJhY3Rpb25zIjpbInB1bGwiXX1dLCJhdWQiOiJyZWdpc3RyeS5kb2NrZXIuaW8iLCJleHAiOjE1NDI0MTg2MjgsImlhdCI6MTU0MjQxODMyOCwiaXNzIjoiYXV0aC5kb2NrZXIuaW8iLCJqdGkiOiI1SG5JQllqVkluZERFYlRkRlUzOSIsIm5iZiI6MTU0MjQxODAyOCwic3ViIjoiIn0.zzVk9t-govqoyzQCwHfivOAkdIG0D6r5RoMS7HRq4vOBj1bQdASOfB6YqVLGWP6G-4cf6ESCDTxdidREgZYnklpApX7dYdrAf6OpxA5HXP5MYDMTE7PEZueoUpBipz0UsPI4lzMC1j80UjjgTVHyjiIMcwgxPXpT6-zPJJFp9EjDrLsBHtj2cdmPv_54KA0j50VQLZKccUvC67z0iT5KpSRvKyFcWLEActeCnmuZjkJgySmaVduVfLiDLFbboBOw0mNLeTFIodfHoEdFqYBooBK1d_x37GFCSunYH8fFZ0XkfS7OFDyaYiOlQzafbnz0TxLIUU-jOEsJkaofOnHF2Q",
    "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsIng1YyI6WyJNSUlDK2pDQ0FwK2dBd0lCQWdJQkFEQUtCZ2dxaGtqT1BRUURBakJHTVVRd1FnWURWUVFERXpzeVYwNVpPbFZMUzFJNlJFMUVVanBTU1U5Rk9reEhOa0U2UTFWWVZEcE5SbFZNT2tZelNFVTZOVkF5VlRwTFNqTkdPa05CTmxrNlNrbEVVVEFlRncweE9EQXlNVFF5TXpBMk5EZGFGdzB4T1RBeU1UUXlNekEyTkRkYU1FWXhSREJDQmdOVkJBTVRPMVpCUTFZNk5VNWFNenBNTkZSWk9sQlFTbGc2VWsxQlZEcEdWalpQT2xZMU1sTTZRa2szV2pwU1REVk9PbGhXVDBJNlFsTmFSanBHVTFRMk1JSUJJakFOQmdrcWhraUc5dzBCQVFFRkFBT0NBUThBTUlJQkNnS0NBUUVBMGtyTmgyZWxESnVvYjVERWd5Wi9oZ3l1ZlpxNHo0OXdvNStGRnFRK3VPTGNCMDRyc3N4cnVNdm1aSzJZQ0RSRVRERU9xNW5keEVMMHNaTE51UXRMSlNRdFY1YUhlY2dQVFRkeVJHUTl2aURPWGlqNFBocE40R0N0eFV6YTNKWlNDZC9qbm1YbmtUeDViOElUWXBCZzg2TGNUdmMyRFVUV2tHNy91UThrVjVPNFFxNlZKY05TUWRId1B2Mmp4YWRZa3hBMnhaaWNvRFNFQlpjWGRneUFCRWI2YkRnUzV3QjdtYjRRVXBuM3FXRnRqdCttKzBsdDZOR3hvenNOSFJHd3EwakpqNWtZbWFnWHpEQm5NQ3l5eDFBWFpkMHBNaUlPSjhsaDhRQ09GMStsMkVuV1U1K0thaTZKYVNEOFZJc2VrRzB3YXd4T1dER3U0YzYreE1XYUx3SURBUUFCbzRHeU1JR3ZNQTRHQTFVZER3RUIvd1FFQXdJSGdEQVBCZ05WSFNVRUNEQUdCZ1JWSFNVQU1FUUdBMVVkRGdROUJEdFdRVU5XT2pWT1dqTTZURFJVV1RwUVVFcFlPbEpOUVZRNlJsWTJUenBXTlRKVE9rSkpOMW82VWt3MVRqcFlWazlDT2tKVFdrWTZSbE5VTmpCR0JnTlZIU01FUHpBOWdEc3lWMDVaT2xWTFMxSTZSRTFFVWpwU1NVOUZPa3hITmtFNlExVllWRHBOUmxWTU9rWXpTRVU2TlZBeVZUcExTak5HT2tOQk5sazZTa2xFVVRBS0JnZ3Foa2pPUFFRREFnTkpBREJHQWlFQWdZTWF3Si9uMXM0dDlva0VhRjh2aGVkeURzbERObWNyTHNRNldmWTFmRTRDSVFEbzNWazJXcndiSjNmU1dwZEVjT3hNazZ1ZEFwK2c1Nkd6TjlRSGFNeVZ1QT09Il19.eyJhY2Nlc3MiOlt7InR5cGUiOiJyZXBvc2l0b3J5IiwibmFtZSI6ImxpYnJhcnkvbmdpbngiLCJhY3Rpb25zIjpbInB1bGwiXX1dLCJhdWQiOiJyZWdpc3RyeS5kb2NrZXIuaW8iLCJleHAiOjE1NDI0MTg2MjgsImlhdCI6MTU0MjQxODMyOCwiaXNzIjoiYXV0aC5kb2NrZXIuaW8iLCJqdGkiOiI1SG5JQllqVkluZERFYlRkRlUzOSIsIm5iZiI6MTU0MjQxODAyOCwic3ViIjoiIn0.zzVk9t-govqoyzQCwHfivOAkdIG0D6r5RoMS7HRq4vOBj1bQdASOfB6YqVLGWP6G-4cf6ESCDTxdidREgZYnklpApX7dYdrAf6OpxA5HXP5MYDMTE7PEZueoUpBipz0UsPI4lzMC1j80UjjgTVHyjiIMcwgxPXpT6-zPJJFp9EjDrLsBHtj2cdmPv_54KA0j50VQLZKccUvC67z0iT5KpSRvKyFcWLEActeCnmuZjkJgySmaVduVfLiDLFbboBOw0mNLeTFIodfHoEdFqYBooBK1d_x37GFCSunYH8fFZ0XkfS7OFDyaYiOlQzafbnz0TxLIUU-jOEsJkaofOnHF2Q",
    "expires_in": 300,
    "issued_at": "2018-11-17T01:32:08.367366757Z"
}
```

设置 token var

```
export token=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsIng1YyI6WyJNSUlDK2pDQ0FwK2dBd0lCQWdJQkFEQUtCZ2dxaGtqT1BRUURBakJHTVVRd1FnWURWUVFERXpzeVYwNVpPbFZMUzFJNlJFMUVVanBTU1U5Rk9reEhOa0U2UTFWWVZEcE5SbFZNT2tZelNFVTZOVkF5VlRwTFNqTkdPa05CTmxrNlNrbEVVVEFlRncweE9EQXlNVFF5TXpBMk5EZGFGdzB4T1RBeU1UUXlNekEyTkRkYU1FWXhSREJDQmdOVkJBTVRPMVpCUTFZNk5VNWFNenBNTkZSWk9sQlFTbGc2VWsxQlZEcEdWalpQT2xZMU1sTTZRa2szV2pwU1REVk9PbGhXVDBJNlFsTmFSanBHVTFRMk1JSUJJakFOQmdrcWhraUc5dzBCQVFFRkFBT0NBUThBTUlJQkNnS0NBUUVBMGtyTmgyZWxESnVvYjVERWd5Wi9oZ3l1ZlpxNHo0OXdvNStGRnFRK3VPTGNCMDRyc3N4cnVNdm1aSzJZQ0RSRVRERU9xNW5keEVMMHNaTE51UXRMSlNRdFY1YUhlY2dQVFRkeVJHUTl2aURPWGlqNFBocE40R0N0eFV6YTNKWlNDZC9qbm1YbmtUeDViOElUWXBCZzg2TGNUdmMyRFVUV2tHNy91UThrVjVPNFFxNlZKY05TUWRId1B2Mmp4YWRZa3hBMnhaaWNvRFNFQlpjWGRneUFCRWI2YkRnUzV3QjdtYjRRVXBuM3FXRnRqdCttKzBsdDZOR3hvenNOSFJHd3EwakpqNWtZbWFnWHpEQm5NQ3l5eDFBWFpkMHBNaUlPSjhsaDhRQ09GMStsMkVuV1U1K0thaTZKYVNEOFZJc2VrRzB3YXd4T1dER3U0YzYreE1XYUx3SURBUUFCbzRHeU1JR3ZNQTRHQTFVZER3RUIvd1FFQXdJSGdEQVBCZ05WSFNVRUNEQUdCZ1JWSFNVQU1FUUdBMVVkRGdROUJEdFdRVU5XT2pWT1dqTTZURFJVV1RwUVVFcFlPbEpOUVZRNlJsWTJUenBXTlRKVE9rSkpOMW82VWt3MVRqcFlWazlDT2tKVFdrWTZSbE5VTmpCR0JnTlZIU01FUHpBOWdEc3lWMDVaT2xWTFMxSTZSRTFFVWpwU1NVOUZPa3hITmtFNlExVllWRHBOUmxWTU9rWXpTRVU2TlZBeVZUcExTak5HT2tOQk5sazZTa2xFVVRBS0JnZ3Foa2pPUFFRREFnTkpBREJHQWlFQWdZTWF3Si9uMXM0dDlva0VhRjh2aGVkeURzbERObWNyTHNRNldmWTFmRTRDSVFEbzNWazJXcndiSjNmU1dwZEVjT3hNazZ1ZEFwK2c1Nkd6TjlRSGFNeVZ1QT09Il19.eyJhY2Nlc3MiOlt7InR5cGUiOiJyZXBvc2l0b3J5IiwibmFtZSI6ImxpYnJhcnkvbmdpbngiLCJhY3Rpb25zIjpbInB1bGwiXX1dLCJhdWQiOiJyZWdpc3RyeS5kb2NrZXIuaW8iLCJleHAiOjE1NDI0MTg2MjgsImlhdCI6MTU0MjQxODMyOCwiaXNzIjoiYXV0aC5kb2NrZXIuaW8iLCJqdGkiOiI1SG5JQllqVkluZERFYlRkRlUzOSIsIm5iZiI6MTU0MjQxODAyOCwic3ViIjoiIn0.zzVk9t-govqoyzQCwHfivOAkdIG0D6r5RoMS7HRq4vOBj1bQdASOfB6YqVLGWP6G-4cf6ESCDTxdidREgZYnklpApX7dYdrAf6OpxA5HXP5MYDMTE7PEZueoUpBipz0UsPI4lzMC1j80UjjgTVHyjiIMcwgxPXpT6-zPJJFp9EjDrLsBHtj2cdmPv_54KA0j50VQLZKccUvC67z0iT5KpSRvKyFcWLEActeCnmuZjkJgySmaVduVfLiDLFbboBOw0mNLeTFIodfHoEdFqYBooBK1d_x37GFCSunYH8fFZ0XkfS7OFDyaYiOlQzafbnz0TxLIUU-jOEsJkaofOnHF2Q
```

# Pull

1. Get Image Manifest

```
curl -v -H "Authorization: Bearer $token" -H "Accept: application/vnd.docker.distribution.manifest.v2+json" "https://registry.hub.docker.com/v2/library/nginx/manifests/latest"
resp

{
    "schemaVersion": 2,
    "mediaType": "application/vnd.docker.distribution.manifest.v2+json",
    "config": {
        "mediaType": "application/vnd.docker.container.image.v1+json",
        "size": 6022,
        "digest": "sha256:e81eb098537d6c4a75438eacc6a2ed94af74ca168076f719f3a0558bd24d646a"
    },
    "layers": [
        {
            "mediaType": "application/vnd.docker.image.rootfs.diff.tar.gzip",
            "size": 22486277,
            "digest": "sha256:a5a6f2f73cd8abbdc55d0df0d8834f7262713e87d6c8800ea3851f103025e0f0"
        },
        {
            "mediaType": "application/vnd.docker.image.rootfs.diff.tar.gzip",
            "size": 22204196,
            "digest": "sha256:67da5fbcb7a04397eda35dccb073d8569d28de13172fbd569fbb7a3e30b5886b"
        },
        {
            "mediaType": "application/vnd.docker.image.rootfs.diff.tar.gzip",
            "size": 203,
            "digest": "sha256:e82455fa5628738170735528c8db36567b5423ec59802a1e2c084ed42b082527"
        }
    ]
}
```

2. Get Image Config

```
curl -i -H "Authorization: Bearer $token" "https://registry.hub.docker.com/v2/library/nginx/blobs/sha256:e81eb098537d6c4a75438eacc6a2ed94af74ca168076f719f3a0558bd24d646a"
HTTP/1.1 307 Temporary Redirect
Content-Type: text/html; charset=utf-8
Docker-Distribution-Api-Version: registry/2.0
Location: https://production.cloudflare.docker.com/registry-v2/docker/registry/v2/blobs/sha256/e8/e81eb098537d6c4a75438eacc6a2ed94af74ca168076f719f3a0558bd24d646a/data?verify=1542423249-8ogA6RSAc3PlmtNd%2FOuiIuAUo3c%3D
Date: Sat, 17 Nov 2018 02:04:09 GMT
Content-Length: 244
Strict-Transport-Security: max-age=31536000
redirect

curl https://production.cloudflare.docker.com/registry-v2/docker/registry/v2/blobs/sha256/e8/e81eb098537d6c4a75438eacc6a2ed94af74ca168076f719f3a0558bd24d646a/data?verify=1542423249-8ogA6RSAc3PlmtNd%2FOuiIuAUo3c%3D | python -mjson.tool
config json file

{
    "architecture": "amd64",
    "config": {
        "Hostname": "",
        "Domainname": "",
        "User": "",
        "AttachStdin": false,
        "AttachStdout": false,
        "AttachStderr": false,
        "ExposedPorts": {
            "80/tcp": {}
        },
        "Tty": false,
        "OpenStdin": false,
        "StdinOnce": false,
        "Env": [
            "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            "NGINX_VERSION=1.15.6-1~stretch",
            "NJS_VERSION=1.15.6.0.2.5-1~stretch"
        ],
        "Cmd": [
            "nginx",
            "-g",
            "daemon off;"
        ],
        "ArgsEscaped": true,
        "Image": "sha256:eb4657966d3e92498b450e24969a0a2808f254ab44102f31674543f642e35ed7",
        "Volumes": null,
        "WorkingDir": "",
        "Entrypoint": null,
        "OnBuild": [],
        "Labels": {
            "maintainer": "NGINX Docker Maintainers <docker-maint@nginx.com>"
        },
        "StopSignal": "SIGTERM"
    },
    "container": "d4fa15093ad8ad3df60d7403c1752a379503686e32a76b70771b3ea268ec5d66",
    "container_config": {
        "Hostname": "d4fa15093ad8",
        "Domainname": "",
        "User": "",
        "AttachStdin": false,
        "AttachStdout": false,
        "AttachStderr": false,
        "ExposedPorts": {
            "80/tcp": {}
        },
        "Tty": false,
        "OpenStdin": false,
        "StdinOnce": false,
        "Env": [
            "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            "NGINX_VERSION=1.15.6-1~stretch",
            "NJS_VERSION=1.15.6.0.2.5-1~stretch"
        ],
        "Cmd": [
            "/bin/sh",
            "-c",
            "#(nop) ",
            "CMD [\"nginx\" \"-g\" \"daemon off;\"]"
        ],
        "ArgsEscaped": true,
        "Image": "sha256:eb4657966d3e92498b450e24969a0a2808f254ab44102f31674543f642e35ed7",
        "Volumes": null,
        "WorkingDir": "",
        "Entrypoint": null,
        "OnBuild": [],
        "Labels": {
            "maintainer": "NGINX Docker Maintainers <docker-maint@nginx.com>"
        },
        "StopSignal": "SIGTERM"
    },
    "created": "2018-11-16T13:32:10.147294787Z",
    "docker_version": "17.06.2-ce",
    "history": [
        {
            "created": "2018-11-15T22:45:06.938205528Z",
            "created_by": "/bin/sh -c #(nop) ADD file:dab9baf938799c515ddce14c02f899da5992f0b76a432fa10a2338556a3cb04f in / "
        },
        {
            "created": "2018-11-15T22:45:07.243453424Z",
            "created_by": "/bin/sh -c #(nop)  CMD [\"bash\"]",
            "empty_layer": true
        },
        {
            "created": "2018-11-16T13:31:11.175776557Z",
            "created_by": "/bin/sh -c #(nop)  LABEL maintainer=NGINX Docker Maintainers <docker-maint@nginx.com>",
            "empty_layer": true
        },
        {
            "created": "2018-11-16T13:31:11.487598267Z",
            "created_by": "/bin/sh -c #(nop)  ENV NGINX_VERSION=1.15.6-1~stretch",
            "empty_layer": true
        },
        {
            "created": "2018-11-16T13:31:11.783900832Z",
            "created_by": "/bin/sh -c #(nop)  ENV NJS_VERSION=1.15.6.0.2.5-1~stretch",
            "empty_layer": true
        },
        {
            "created": "2018-11-16T13:32:07.382613887Z",
            "created_by": "/bin/sh -c set -x \t&& apt-get update \t&& apt-get install --no-install-recommends --no-install-suggests -y gnupg1 apt-transport-https ca-certificates \t&& \tNGINX_GPGKEY=573BFD6B3D8FBC641079A6ABABF5BD827BD9BF62; \tfound=''; \tfor server in \t\tha.pool.sks-keyservers.net \t\thkp://keyserver.ubuntu.com:80 \t\thkp://p80.pool.sks-keyservers.net:80 \t\tpgp.mit.edu \t; do \t\techo \"Fetching GPG key $NGINX_GPGKEY from $server\"; \t\tapt-key adv --keyserver \"$server\" --keyserver-options timeout=10 --recv-keys \"$NGINX_GPGKEY\" && found=yes && break; \tdone; \ttest -z \"$found\" && echo >&2 \"error: failed to fetch GPG key $NGINX_GPGKEY\" && exit 1; \tapt-get remove --purge --auto-remove -y gnupg1 && rm -rf /var/lib/apt/lists/* \t&& dpkgArch=\"$(dpkg --print-architecture)\" \t&& nginxPackages=\" \t\tnginx=${NGINX_VERSION} \t\tnginx-module-xslt=${NGINX_VERSION} \t\tnginx-module-geoip=${NGINX_VERSION} \t\tnginx-module-image-filter=${NGINX_VERSION} \t\tnginx-module-njs=${NJS_VERSION} \t\" \t&& case \"$dpkgArch\" in \t\tamd64|i386) \t\t\techo \"deb https://nginx.org/packages/mainline/debian/ stretch nginx\" >> /etc/apt/sources.list.d/nginx.list \t\t\t&& apt-get update \t\t\t;; \t\t*) \t\t\techo \"deb-src https://nginx.org/packages/mainline/debian/ stretch nginx\" >> /etc/apt/sources.list.d/nginx.list \t\t\t\t\t\t&& tempDir=\"$(mktemp -d)\" \t\t\t&& chmod 777 \"$tempDir\" \t\t\t\t\t\t&& savedAptMark=\"$(apt-mark showmanual)\" \t\t\t\t\t\t&& apt-get update \t\t\t&& apt-get build-dep -y $nginxPackages \t\t\t&& ( \t\t\t\tcd \"$tempDir\" \t\t\t\t&& DEB_BUILD_OPTIONS=\"nocheck parallel=$(nproc)\" \t\t\t\t\tapt-get source --compile $nginxPackages \t\t\t) \t\t\t\t\t\t&& apt-mark showmanual | xargs apt-mark auto > /dev/null \t\t\t&& { [ -z \"$savedAptMark\" ] || apt-mark manual $savedAptMark; } \t\t\t\t\t\t&& ls -lAFh \"$tempDir\" \t\t\t&& ( cd \"$tempDir\" && dpkg-scanpackages . > Packages ) \t\t\t&& grep '^Package: ' \"$tempDir/Packages\" \t\t\t&& echo \"deb [ trusted=yes ] file://$tempDir ./\" > /etc/apt/sources.list.d/temp.list \t\t\t&& apt-get -o Acquire::GzipIndexes=false update \t\t\t;; \tesac \t\t&& apt-get install --no-install-recommends --no-install-suggests -y \t\t\t\t\t\t$nginxPackages \t\t\t\t\t\tgettext-base \t&& apt-get remove --purge --auto-remove -y apt-transport-https ca-certificates && rm -rf /var/lib/apt/lists/* /etc/apt/sources.list.d/nginx.list \t\t&& if [ -n \"$tempDir\" ]; then \t\tapt-get purge -y --auto-remove \t\t&& rm -rf \"$tempDir\" /etc/apt/sources.list.d/temp.list; \tfi"
        },
        {
            "created": "2018-11-16T13:32:08.778195069Z",
            "created_by": "/bin/sh -c ln -sf /dev/stdout /var/log/nginx/access.log \t&& ln -sf /dev/stderr /var/log/nginx/error.log"
        },
        {
            "created": "2018-11-16T13:32:09.22115772Z",
            "created_by": "/bin/sh -c #(nop)  EXPOSE 80/tcp",
            "empty_layer": true
        },
        {
            "created": "2018-11-16T13:32:09.696803649Z",
            "created_by": "/bin/sh -c #(nop)  STOPSIGNAL [SIGTERM]",
            "empty_layer": true
        },
        {
            "created": "2018-11-16T13:32:10.147294787Z",
            "created_by": "/bin/sh -c #(nop)  CMD [\"nginx\" \"-g\" \"daemon off;\"]",
            "empty_layer": true
        }
    ],
    "os": "linux",
    "rootfs": {
        "type": "layers",
        "diff_ids": [
            "sha256:ef68f6734aa485edf13a8509fe60e4272428deaf63f446a441b79d47fc5d17d3",
            "sha256:876456b964239fb297770341ec7e4c2630e42b64b7bbad5112becb1bd2c72795",
            "sha256:9a8f339aeebe1e8bcef322376e1274360653fb802abd4b94c69ea45a54f71a2b"
        ]
    }
}
```

3. Get Image Layers

根据 Image Manifest Layers 下载 Image Layers

```
curl -i -H "Authorization: Bearer $token" -H "Accept: application/vnd.docker.distribution.manifest.v2+json" "https://registry.hub.docker.com/v2/library/nginx/blobs/sha256:a5a6f2f73cd8abbdc55d0df0d8834f7262713e87d6c8800ea3851f103025e0f0"
curl -o a5a6f2f73cd8abbdc55d0df0d8834f7262713e87d6c8800ea3851f103025e0f0.tar.gz https://production.cloudflare.docker.com/registry-v2/docker/registry/v2/blobs/sha256/a5/a5a6f2f73cd8abbdc55d0df0d8834f7262713e87d6c8800ea3851f103025e0f0/data?verify=1542424303-e8ERUR8oG%2BoBh41TGIpCy7iFeYg%3D
curl -i -H "Authorization: Bearer $token" -H "Accept: application/vnd.docker.distribution.manifest.v2+json" "https://registry.hub.docker.com/v2/library/nginx/blobs/sha256:67da5fbcb7a04397eda35dccb073d8569d28de13172fbd569fbb7a3e30b5886b"
curl -o 67da5fbcb7a04397eda35dccb073d8569d28de13172fbd569fbb7a3e30b5886b.tar.gz https://production.cloudflare.docker.com/registry-v2/docker/registry/v2/blobs/sha256/67/67da5fbcb7a04397eda35dccb073d8569d28de13172fbd569fbb7a3e30b5886b/data\?verify\=1542424505-PVOE52Er6OY7iKDTx5QZSZxI99I%3D
curl -i -H "Authorization: Bearer $token" -H "Accept: application/vnd.docker.distribution.manifest.v2+json" "https://registry.hub.docker.com/v2/library/nginx/blobs/sha256:e82455fa5628738170735528c8db36567b5423ec59802a1e2c084ed42b082527"
curl -o e82455fa5628738170735528c8db36567b5423ec59802a1e2c084ed42b082527.tar.gz https://production.cloudflare.docker.com/registry-v2/docker/registry/v2/blobs/sha256/e8/e82455fa5628738170735528c8db36567b5423ec59802a1e2c084ed42b082527/data\?verify\=1542424575-kXRXCIAWm%2FXyHHfrhI1yOIPt4FA%3D
```

4. Generated Image Tar Archive Description (manifest.json)

根据 Config file 及 Layers files 的组织目录结构，生成 Image Tar Archive Manifest

```
[
    {
        "Config": "sha256:e81eb098537d6c4a75438eacc6a2ed94af74ca168076f719f3a0558bd24d646a",
        "RepoTags": [
            "index.docker.io/library/nginx:latest"
        ],
        "Layers": [
            "a5a6f2f73cd8abbdc55d0df0d8834f7262713e87d6c8800ea3851f103025e0f0.tar.gz",
            "67da5fbcb7a04397eda35dccb073d8569d28de13172fbd569fbb7a3e30b5886b.tar.gz",
            "e82455fa5628738170735528c8db36567b5423ec59802a1e2c084ed42b082527.tar.gz"
        ]
    }
]
```

5. Tar Archive File Structure Summary

```
.
├── 67da5fbcb7a04397eda35dccb073d8569d28de13172fbd569fbb7a3e30b5886b.tar.gz --- Layer file
├── a5a6f2f73cd8abbdc55d0df0d8834f7262713e87d6c8800ea3851f103025e0f0.tar.gz --- Layer file
├── e82455fa5628738170735528c8db36567b5423ec59802a1e2c084ed42b082527.tar.gz --- Layer file
├── manifest.json --- Image Tar Archive Description
└── sha256:e81eb098537d6c4a75438eacc6a2ed94af74ca168076f719f3a0558bd24d646a --- Image Config
0 directories, 5 files
```
