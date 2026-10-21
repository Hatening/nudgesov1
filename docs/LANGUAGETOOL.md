# LanguageTool 本地语法引擎（波兰语）

## 安装

1. 安装 Java 17（Windows）：
   ```powershell
   winget install --id Microsoft.OpenJDK.17 --silent --accept-package-agreements --accept-source-agreements
   ```
2. 下载 LanguageTool 6.6：
   ```
   https://languagetool.org/download/LanguageTool-stable.zip
   ```
   解压到 `vendor/languagetool/`（已在 `.gitignore` 中忽略，不入库）。

## 启动

```powershell
$java = "$env:LOCALAPPDATA\Programs\Microsoft\jdk-17.0.10.7-hotspot\bin\java.exe"
java -Xmx1200m -jar vendor\languagetool\LanguageTool-6.6\languagetool-server.jar --port 8081
```

## 验证

```powershell
Invoke-RestMethod "http://127.0.0.1:8081/v2/check" -Method Post -Body @{
  language = 'pl-PL'
  text = 'Czy ShipBob może pomóc w problemach z zgodnością?'
}
```

应返回 `Z_ZE` 规则：`z zgodnością` → `ze zgodnością`。

## 在流水线中使用

- 客户端：`scripts/lib/languagetool.mjs`（默认 `LANGUAGETOOL_URL=http://127.0.0.1:8081`）
- 只应用白名单类别（GRAMMAR / PHONETICS / MISC / PUNCTUATION / TYPOGRAPHY）
- 禁用大小写规则（避免把 `ShipBob` 改成 `shipbob`）
- 混合双打 Pilot：`node scripts/pilot-hybrid.mjs`
