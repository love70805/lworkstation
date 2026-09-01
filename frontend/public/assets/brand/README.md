# Lworkstation brand assets

## `lworkstation-horizontal-main-logo.jpg`

- Source: Google Stitch project `Smart Selection Hub`
- Stitch project ID: `15697384510226406048`
- Stitch screen title: `Lworkstation 横向主 Logo`
- Stitch screen ID: `4ce058dbca7b48999912d4a383343c97`
- Stitch canvas size: `1024 x 1024`
- Downloaded file type: JPEG (JFIF)
- Downloaded file size: `512 x 512`
- SHA-256: `6FBF9F977DBF7C34CE3FB78A592D69D55E60355315C3ECB6B8DE200A8353ABF1`
- HTML code: unavailable; Stitch returned an empty `htmlCode` object for this image-only screen.

The image was downloaded from Stitch's hosted screenshot export. The transient
download URL is intentionally not stored or used as a runtime dependency. It is
kept as source evidence and is never rendered directly in the application UI.

## Derived production assets

The hosted source is a 512 x 512 raster image despite the 1024 x 1024 Stitch
canvas metadata. The production SVGs were reconstructed from the source's clear
geometric boundaries and proportions instead of enlarging the raster and
presenting it as vector artwork.

### `l7-app-icon-master.svg`

- Format and canvas: SVG, `1024 x 1024` viewBox
- Use: collapsed React sidebar and the only approved master for future Windows
  icon generation
- Construction: blue rounded square with the reconstructed white L7 geometry
- SHA-256: `07A556FA1A57EC9E147138CFA97443214FF63AB0E67CB4B3AD10EB4A5708DA53`

Desktop packaging must derive icon sizes from
`frontend/public/assets/brand/l7-app-icon-master.svg`. Do not derive desktop
icons from the JPEG or either horizontal wordmark.

### `lworkstation-wordmark-light.svg`

- Format and canvas: transparent SVG, `620 x 160` viewBox
- Use: expanded sidebar on light surfaces
- Color treatment: dark wordmark with the blue L7 mark
- SHA-256: `663CA7C474277E60AA56E19568A32F12763A00EAFEBD3A21FC4D69B6F3C1D330`

### `lworkstation-wordmark-dark.svg`

- Format and canvas: transparent SVG, `620 x 160` viewBox
- Use: expanded sidebar on dark surfaces
- Color treatment: light wordmark with the blue L7 mark
- SHA-256: `D153D3E63576923BC11602EFD30411829C525F7F5D909169BF2F60F25769988C`
