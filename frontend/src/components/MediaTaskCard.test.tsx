import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { MediaTaskCard } from './MediaTaskCard';

async function renderCard(task: Record<string, unknown>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<MediaTaskCard task={task} />);
    await Promise.resolve();
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('MediaTaskCard', () => {
  it('renders completed video output from artifact_path', async () => {
    const { container, root } = await renderCard({
      kind: 'video',
      status: 'completed',
      progress_pct: 100,
      artifact_path: 'https://example.com/final.mp4',
      thumbnail_url: 'https://example.com/final.jpg',
    });

    const video = container.querySelector('video');
    expect(video).toBeTruthy();
    expect(video?.getAttribute('src')).toBe('https://example.com/final.mp4');

    await act(async () => root.unmount());
  });

  it('renders generated image output inline', async () => {
    const { container, root } = await renderCard({
      kind: 'image',
      status: 'completed',
      progress_pct: 100,
      output_url: 'https://example.com/final.png',
    });

    const image = container.querySelector('img[alt="Generated image output"]');
    expect(image).toBeTruthy();
    expect(image?.getAttribute('src')).toBe('https://example.com/final.png');

    await act(async () => root.unmount());
  });

  it('renders failure state and error details', async () => {
    const { container, root } = await renderCard({
      kind: 'music',
      status: 'failed',
      progress_pct: 0,
      error: 'No media provider configured',
    });

    expect(container.textContent).toContain('failed');
    expect(container.textContent).toContain('No media provider configured');

    await act(async () => root.unmount());
  });

  it('infers video rendering from mime_type when kind is absent', async () => {
    const { container, root } = await renderCard({
      status: 'completed',
      progress_pct: 100,
      mime_type: 'video/mp4',
      artifact_path: 'https://example.com/inferred.mp4',
    });

    const video = container.querySelector('video');
    expect(video).toBeTruthy();
    expect(video?.getAttribute('src')).toBe('https://example.com/inferred.mp4');
    expect(container.textContent).toContain('video task');

    await act(async () => root.unmount());
  });

  it('renders detailed media progress steps when present', async () => {
    const { container, root } = await renderCard({
      kind: 'video',
      status: 'generating',
      progress_pct: 55,
      steps: [
        { label: 'routing', status: 'done' },
        { label: 'generating', status: 'active' },
        { label: 'finalizing', status: 'pending' },
      ],
    });

    expect(container.textContent).toContain('routing');
    expect(container.textContent).toContain('generating');
    expect(container.textContent).toContain('finalizing');

    await act(async () => root.unmount());
  });

  it('renders music generation details when present', async () => {
    const { container, root } = await renderCard({
      kind: 'music',
      status: 'generating',
      progress_pct: 45,
      duration: 30,
      genre: 'synthwave',
      mood: 'cinematic',
      tempo: 'midtempo',
      instrumental: true,
      lyrics: 'neon nights',
    });

    expect(container.textContent).toContain('30s');
    expect(container.textContent).toContain('synthwave');
    expect(container.textContent).toContain('cinematic');
    expect(container.textContent).toContain('midtempo');
    expect(container.textContent).toContain('instrumental');
    expect(container.textContent).toContain('lyrics');

    await act(async () => root.unmount());
  });
});
