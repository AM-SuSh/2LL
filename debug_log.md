#### 预览页无法正常显示图片

#### 读取草稿进行编辑，光标和字符插入位置不符预期
    @monaco-editor/react 在传入受控属性 value 时，一旦发现和编辑器里不一致，会用一次 executeEdits 覆盖整篇文档。这和你在某处输入、光标在开头时触发的更新叠在一起，容易出现 光标被挪到文末、新字被接到末尾 的现象。加载草稿后更容易触发，因为随后既有大块文本替换，又有频繁的状态刷新。

    - 去掉 value，改用 defaultValue
    日常输入由 Monaco 自己维护文档，只通过 onChange 把内容同步到 React（预览、导出、保存仍用 zhText / enText）。

    - 增加 docSessionKey
    在 从 IndexedDB 恢复 或 导入/打开草稿 这种需要整篇替换时执行 setDocSessionKey(k => k + 1)，并给两个 Editor 加上 key={zh-${docSessionKey}} / key={en-${docSessionKey}}，让编辑器重新挂载并带上新的 defaultValue，避免整篇 replace 和光标错乱。

    - 翻译
    英文栏不再靠受控 value 更新，在 setEnText 后增加 enEditorRef.current?.setValue?.(r.translated)；中文源文优先用 zhEditorRef.current.getValue()，避免状态和编辑器短时不同步。