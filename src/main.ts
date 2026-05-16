import './components/chrono-map/ChronoMap.scss';
import { ChronoMap } from './components/chrono-map/ChronoMap';

declare global {
  interface Window { chronomap?: ChronoMap; }
}

const container = document.getElementById('chronomap');
if (!container) throw new Error('Missing #chronomap mount point');

const chronomap = new ChronoMap({
  container,
});

window.chronomap = chronomap;
