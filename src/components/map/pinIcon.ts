import L from 'leaflet'

// A teardrop pin as a divIcon — sidesteps Leaflet's broken default marker image
// paths under bundlers without pulling in a plugin.
export function pinIcon(color: string) {
  return L.divIcon({
    className: 'gig-location-pin',
    html:
      `<div style="width:22px;height:22px;background:${color};border:2px solid #fff;` +
      'border-radius:50% 50% 50% 0;transform:rotate(-45deg);' +
      'box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>',
    iconSize: [22, 22],
    iconAnchor: [11, 22],
    popupAnchor: [0, -20],
  })
}
