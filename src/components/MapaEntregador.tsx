'use client'

import { useEffect, useRef } from 'react'
import type { Map, Marker } from 'leaflet'
import type { LocalizacaoEntregador } from '@/types/entregador'

interface Props {
  localizacao: LocalizacaoEntregador
}

export default function MapaEntregador({ localizacao }: Props) {
  const mapRef = useRef<Map | null>(null)
  const markerRef = useRef<Marker | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    // Importa leaflet apenas no cliente
    import('leaflet').then(L => {
      // Fix default icon paths
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      })

      const map = L.map(containerRef.current!).setView(
        [localizacao.lat, localizacao.lng],
        16
      )

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
      }).addTo(map)

      const motoIcon = L.divIcon({
        html: '<div style="font-size:28px;line-height:1;">🛵</div>',
        className: '',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      })

      const marker = L.marker([localizacao.lat, localizacao.lng], { icon: motoIcon }).addTo(map)

      mapRef.current = map
      markerRef.current = marker
    })

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
        markerRef.current = null
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mapRef.current || !markerRef.current) return
    const latlng: [number, number] = [localizacao.lat, localizacao.lng]
    markerRef.current.setLatLng(latlng)
    mapRef.current.panTo(latlng)
  }, [localizacao.lat, localizacao.lng])

  return (
    <>
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        crossOrigin=""
      />
      <div ref={containerRef} style={{ height: '50vh', width: '100%' }} />
    </>
  )
}
