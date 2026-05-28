export interface CaptureInput {
  value: string;
}

export async function clearInputAfterSuccessfulCapture(
  input: CaptureInput,
  capture: () => Promise<boolean>,
): Promise<boolean> {
  const captured = await capture();
  if (captured) {
    input.value = "";
  }
  return captured;
}
