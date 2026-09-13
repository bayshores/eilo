# Glass wordmark

Load wordmark.css and init.js to enhance existing .wordmark elements.
The original lettering retains layout and accessible text; failed font loading
leaves that fallback unchanged. Bricolage Grotesque is distributed under the
adjacent OFL license.

mountGlassWordmark(host) supports explicit mounting and returns a destroy()
handle. Use a single owner for each host; remove legacy replay handlers when
adopting it in a shell with an existing animation.

The material is shallow SVG relief with a masked, filtered backdrop. It is not
volumetric ray-traced glass. Letter geometry stays fixed while light moves at
up to 30 paints per second. Pointer response eases continuously into and out of
the current state. Rendering stops for hidden/offscreen content, page visibility,
OS reduced motion, forced colors, .reduce-motion, and .motion-paused.
High-contrast mode displays the original text.

Keep the geometry, material and rendering loop local to this component. Panel
styles and navigation are intentionally not imported. The 3D appearance and
transparency require visual review in the target browser and at the intended size.
