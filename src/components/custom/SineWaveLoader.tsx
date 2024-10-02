import React, { useRef, useEffect } from "react";

interface SineWaveLoaderProps {
  width?: number;
  height?: number;
  color?: string;
  amplitude?: number;
  frequency?: number;
  message?: string;
  messageFont?: string;
  withBox?: boolean;
  boxWidth?: number;
  boxHeight?: number;
  boxColor?: string;
  textColor?: string;
  lineThickness?: number;
  borderRadius?: number;
  featherAmount?: number;
  blurAmount?: number; // New prop for Gaussian blur
}

const SineWaveLoader: React.FC<SineWaveLoaderProps> = ({
  width = 300,
  height = 100,
  color = "#3498db",
  amplitude = 140,
  frequency = 0.02,
  message = "Loading...",
  messageFont = "14px Arial",
  withBox = false,
  boxWidth = 100,
  boxHeight = 40,
  boxColor = "rgba(255, 255, 255, 0.8)",
  textColor = "#333",
  lineThickness = 2,
  borderRadius = 0,
  featherAmount = 0,
  blurAmount = 0, // Default to no blur
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let offset = 0;

    const animate = () => {
      ctx.clearRect(0, 0, width, height);

      // Draw sine wave
      ctx.beginPath();
      for (let x = 1; x < width; x++) {
        const y = height / 2 + amplitude * Math.sin((x + offset) * frequency);
        if (x === 1) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = lineThickness;
      ctx.stroke();

      if (withBox) {
        // Create an offscreen canvas for the box
        const offscreenCanvas = document.createElement("canvas");
        offscreenCanvas.width = width;
        offscreenCanvas.height = height;
        const offscreenCtx = offscreenCanvas.getContext("2d");
        if (!offscreenCtx) return;

        // Draw centered box with rounded corners and feathering on offscreen canvas
        const boxX = (width - boxWidth) / 2;
        const boxY = (height - boxHeight) / 2;

        if (featherAmount > 0) {
          const gradient = offscreenCtx.createRadialGradient(
            width / 2,
            height / 2,
            0,
            width / 2,
            height / 2,
            Math.max(boxWidth, boxHeight) / 2
          );
          gradient.addColorStop(0, boxColor);
          gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
          offscreenCtx.fillStyle = gradient;
        } else {
          offscreenCtx.fillStyle = boxColor;
        }

        if (borderRadius > 0) {
          offscreenCtx.beginPath();
          offscreenCtx.moveTo(boxX + borderRadius, boxY);
          offscreenCtx.lineTo(boxX + boxWidth - borderRadius, boxY);
          offscreenCtx.quadraticCurveTo(
            boxX + boxWidth,
            boxY,
            boxX + boxWidth,
            boxY + borderRadius
          );
          offscreenCtx.lineTo(boxX + boxWidth, boxY + boxHeight - borderRadius);
          offscreenCtx.quadraticCurveTo(
            boxX + boxWidth,
            boxY + boxHeight,
            boxX + boxWidth - borderRadius,
            boxY + boxHeight
          );
          offscreenCtx.lineTo(boxX + borderRadius, boxY + boxHeight);
          offscreenCtx.quadraticCurveTo(
            boxX,
            boxY + boxHeight,
            boxX,
            boxY + boxHeight - borderRadius
          );
          offscreenCtx.lineTo(boxX, boxY + borderRadius);
          offscreenCtx.quadraticCurveTo(boxX, boxY, boxX + borderRadius, boxY);
          offscreenCtx.closePath();
          offscreenCtx.fill();
        } else {
          offscreenCtx.fillRect(boxX, boxY, boxWidth, boxHeight);
        }

        // Apply Gaussian blur if blurAmount > 0
        if (blurAmount > 0) {
          ctx.filter = `blur(${blurAmount}px)`;
        }

        // Draw the offscreen canvas onto the main canvas
        ctx.drawImage(offscreenCanvas, 0, 0);
      }

      // Reset the filter
      ctx.filter = "none";

      // Draw text
      ctx.fillStyle = textColor;
      ctx.font = messageFont;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(message, width / 2, height / 2);

      offset += 5;
      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [
    width,
    height,
    color,
    amplitude,
    frequency,
    message,
    boxWidth,
    boxHeight,
    boxColor,
    textColor,
    lineThickness,
    borderRadius,
    featherAmount,
    blurAmount,
  ]);

  return <canvas ref={canvasRef} width={width} height={height} />;
};

export default SineWaveLoader;
