import { useState, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight, Video } from 'lucide-react';
import type { Asset } from './types';

export function MediaSlider({ assets, title = 'Saved inspiration', compact = false, onOpen }: { assets: Asset[]; title?: string; compact?: boolean; onOpen?: () => void }) {
  const [index, setIndex] = useState(0);
  const activeIndex = Math.min(index, Math.max(0, assets.length - 1));
  const active = assets[activeIndex];
  if (!active) return null;
  const multiple = assets.length > 1;
  const move = (direction: number) => setIndex(Math.max(0, Math.min(assets.length - 1, activeIndex + direction)));
  const keyDown = (event: KeyboardEvent) => {
    if (!multiple || event.target instanceof HTMLVideoElement) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); move(event.key === 'ArrowLeft' ? -1 : 1); }
    if (event.key === 'Home') { event.preventDefault(); setIndex(0); }
    if (event.key === 'End') { event.preventDefault(); setIndex(assets.length - 1); }
  };
  const picture = active.mime.startsWith('video/') ? <video key={active.id} src={`/media/${active.id}${compact ? '#t=0.1' : ''}`} controls={!compact} muted={compact} preload="metadata" aria-label={`Video slide ${activeIndex + 1}`}/> : <img key={active.id} src={`/media/${active.id}`} alt={`${title}${multiple ? ` — slide ${activeIndex + 1} of ${assets.length}` : ''}`} loading={compact ? 'lazy' : 'eager'} draggable={false}/>;
  return <div className={`media-slider ${compact ? 'slider-compact' : 'slider-detail'}`} role="region" aria-roledescription={multiple ? 'carousel' : undefined} aria-label={title} onKeyDown={keyDown} tabIndex={multiple ? 0 : undefined}>
    <div className="slider-stage">
      {onOpen ? <button className="slider-open" onClick={onOpen} aria-label={`Open ${title}`}>{picture}</button> : picture}
      {multiple && <><span className="slider-counter" aria-live="polite" aria-atomic="true">{activeIndex + 1} / {assets.length}</span><button type="button" className="slider-arrow slider-prev" disabled={activeIndex === 0} onClick={() => move(-1)} aria-label="Previous slide"><ChevronLeft size={compact ? 16 : 20}/></button><button type="button" className="slider-arrow slider-next" disabled={activeIndex === assets.length - 1} onClick={() => move(1)} aria-label="Next slide"><ChevronRight size={compact ? 16 : 20}/></button></>}
      {compact && active.mime.startsWith('video/') && <span className="slider-video-mark"><Video size={13}/></span>}
    </div>
    {multiple && (compact ? <div className="slider-dots" aria-label="Choose a slide">{assets.map((asset, i) => <button key={asset.id} className={i === activeIndex ? 'active' : ''} aria-label={`Go to slide ${i + 1}`} aria-current={i === activeIndex ? 'true' : undefined} onClick={() => setIndex(i)}/>)}</div> : <div className="slider-filmstrip" aria-label="Choose a slide">{assets.map((asset, i) => <button key={asset.id} className={i === activeIndex ? 'active' : ''} aria-label={`Go to slide ${i + 1}`} aria-current={i === activeIndex ? 'true' : undefined} onClick={() => setIndex(i)}>{asset.mime.startsWith('video/') ? <Video size={17}/> : <img src={`/media/${asset.id}`} alt="" loading="lazy"/>}<span>{i + 1}</span></button>)}</div>)}
  </div>;
}
