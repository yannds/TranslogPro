import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon   from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl:       markerIcon,
  shadowUrl:     markerShadow,
});

interface Props {
  lat:       number | null;
  lng:       number | null;
  onPick:    (lat: number, lng: number) => void;
  className?: string;
}

function Recenter({ lat, lng }: { lat: number | null; lng: number | null }) {
  const map = useMap();
  useEffect(() => {
    if (lat !== null && lng !== null) {
      map.setView([lat, lng], Math.max(map.getZoom(), 13));
    }
  }, [lat, lng, map]);
  return null;
}

function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function LocationMap({ lat, lng, onPick, className }: Props) {
  // Brazzaville fallback center
  const center: [number, number] = [lat ?? -4.2634, lng ?? 15.2429];
  return (
    <div className={className}>
      <MapContainer
        center={center}
        zoom={lat !== null ? 13 : 6}
        scrollWheelZoom
        style={{ height: '100%', width: '100%', borderRadius: 8 }}
      >
        <TileLayer
          attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <Recenter lat={lat} lng={lng} />
        <ClickHandler onPick={onPick} />
        {lat !== null && lng !== null && (
          <Marker
            position={[lat, lng]}
            draggable
            eventHandlers={{
              dragend(e: L.LeafletEvent) {
                const ll = (e.target as L.Marker).getLatLng();
                onPick(ll.lat, ll.lng);
              },
            }}
          />
        )}
      </MapContainer>
    </div>
  );
}
