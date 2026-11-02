import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ImportPickerDialog } from './ImportPickerDialog';

const validate = (file: File) => (file.name.endsWith('.gpx') ? null : `${file.name} isn't a GPX or FIT file.`);

function setup() {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(<ImportPickerDialog validate={validate} maxFileLabel="20 MB" onPick={onPick} onClose={onClose} />);
  return { onPick, onClose, input: document.querySelector('input[type=file]') as HTMLInputElement };
}

describe('ImportPickerDialog', () => {
  it('shows the accepted formats and the size limit', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Import a route file' })).toBeInTheDocument();
    expect(screen.getByText('20 MB')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse files' })).toBeInTheDocument();
  });

  it('hands a valid chosen file to onPick', async () => {
    const { onPick, input } = setup();
    const file = new File(['<gpx/>'], 'ride.gpx');
    await userEvent.upload(input, file);
    expect(onPick).toHaveBeenCalledWith(file);
  });

  it('refuses an invalid file with a message and keeps the dialog open', async () => {
    const { onPick, input } = setup();
    await userEvent.upload(input, new File(['x'], 'notes.txt'), { applyAccept: false });
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent("notes.txt isn't a GPX or FIT file.");
  });

  it('accepts a dropped file', () => {
    const { onPick } = setup();
    const file = new File(['<gpx/>'], 'drop.gpx');
    fireEvent.drop(screen.getByText('Drop a GPX or FIT file here').parentElement!, {
      dataTransfer: { files: [file], types: ['Files'] },
    });
    expect(onPick).toHaveBeenCalledWith(file);
  });
});
