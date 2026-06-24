{
    assetMenu: function assetMenu(e) {
        return [{
            label: "i18n:preview.assets.preview_in_browser",
            enabled: "scene" === e.importer,
            click() {
                Editor.Message.send("preview", "preview-scene-in-browser", e.uuid)
            }
        }]
    }
}