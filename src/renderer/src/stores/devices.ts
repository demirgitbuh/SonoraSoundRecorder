import { create } from 'zustand'
import { listDevices } from '../audio/capture'
import { platform } from '../api'

interface DeviceState {
  inputs: MediaDeviceInfo[]
  monitors: MediaDeviceInfo[]
  labelsAvailable: boolean
  refresh: () => Promise<void>
}

export const useDevices = create<DeviceState>((set) => ({
  inputs: [],
  monitors: [],
  labelsAvailable: false,
  refresh: async () => {
    try {
      const d = await listDevices(platform)
      set({ inputs: d.inputs, monitors: d.monitors, labelsAvailable: d.labelsAvailable })
    } catch {
      set({ inputs: [], monitors: [], labelsAvailable: false })
    }
  }
}))

let watching = false
export function watchDevices(): void {
  if (watching) return
  watching = true
  void useDevices.getState().refresh()
  navigator.mediaDevices.addEventListener('devicechange', () => void useDevices.getState().refresh())
}
