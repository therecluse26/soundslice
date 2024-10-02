import React, { useRef, useEffect, useCallback, useState } from "react";

interface SineWaveLoaderProps {
  color?: string;
  amplitude?: number;
  frequency?: number;
  message?: string;
  messageFont?: string;
  messageFontSize?: number;
  withBox?: boolean;
  boxColor?: string;
  textColor?: string;
  lineThickness?: number;
  borderRadius?: number;
  featherAmount?: number;
  blurAmount?: number;
  sideFade?: number;
}

const SineWaveLoader: React.FC<SineWaveLoaderProps> = ({
  color = "#3498db",
  amplitude = 0.1, // Now a percentage of height
  frequency = 0.02,
  message = "Loading...",
  messageFont = "ui-sans-serif, system-ui, sans-serif",
  messageFontSize = 20,
  withBox = false,
  boxColor = "rgba(255, 255, 255, 0.8)",
  textColor = "#333",
  lineThickness = 2,
  borderRadius = 0,
  featherAmount = 0,
  blurAmount = 0,
  sideFade = 0,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef(0);
  const lastFrameTime = useRef(0);
  const [dimensions, setDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const adjustedSideFade = Math.min(sideFade, dimensions.width / 4);

  const updateDimensions = useCallback(() => {
    const minWidth = 400; // Adjust this value as needed
    const minHeight = 300; // Adjust this value as needed
    setDimensions({
      width: Math.max(window.innerWidth, minWidth),
      height: Math.max(window.innerHeight, minHeight),
    });
  }, []);

  useEffect(() => {
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, [updateDimensions]);

  const drawSineWave = useCallback(
    (ctx: CanvasRenderingContext2D, offset: number) => {
      const { width, height } = dimensions;
      ctx.beginPath();
      for (let x = 0; x < width; x++) {
        const y =
          height / 2 + height * amplitude * Math.sin((x + offset) * frequency);
        ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = lineThickness;
      ctx.stroke();
      if (sideFade > 0) {
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
        gradient.addColorStop(
          clamp(sideFade / width, 0, 1),
          "rgba(255, 255, 255, 0)"
        );
        gradient.addColorStop(
          clamp(1 - sideFade / width, 0, 1),
          "rgba(255, 255, 255, 0)"
        );
        gradient.addColorStop(1, "rgba(255, 255, 255, 1)");
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = "source-over";
      }
    },
    [dimensions, amplitude, frequency, color, lineThickness, sideFade]
  );

  const drawMessageBox = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const { width, height } = dimensions;
      const boxWidth = Math.min(300, width * 0.8);
      const boxHeight = Math.min(40, height * 0.2); // Adjusted to be responsive
      const boxX = (width - boxWidth) / 2;
      const boxY = (height - boxHeight) / 2;
      if (featherAmount > 0) {
        const gradient = ctx.createRadialGradient(
          width / 2,
          height / 2,
          0,
          width / 2,
          height / 2,
          Math.max(boxWidth, boxHeight) / 2
        );
        gradient.addColorStop(0, boxColor);
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = gradient;
      } else {
        ctx.fillStyle = boxColor;
      }

      if (borderRadius > 0) {
        ctx.beginPath();
        ctx.moveTo(boxX + borderRadius, boxY);
        ctx.lineTo(boxX + boxWidth - borderRadius, boxY);
        ctx.quadraticCurveTo(
          boxX + boxWidth,
          boxY,
          boxX + boxWidth,
          boxY + borderRadius
        );
        ctx.lineTo(boxX + boxWidth, boxY + boxHeight - borderRadius);
        ctx.quadraticCurveTo(
          boxX + boxWidth,
          boxY + boxHeight,
          boxX + boxWidth - borderRadius,
          boxY + boxHeight
        );
        ctx.lineTo(boxX + borderRadius, boxY + boxHeight);
        ctx.quadraticCurveTo(
          boxX,
          boxY + boxHeight,
          boxX,
          boxY + boxHeight - borderRadius
        );
        ctx.lineTo(boxX, boxY + borderRadius);
        ctx.quadraticCurveTo(boxX, boxY, boxX + borderRadius, boxY);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
      }
    },
    [dimensions, boxColor, borderRadius, featherAmount]
  );

  const wrapText = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      text: string,
      x: number,
      y: number,
      maxWidth: number,
      lineHeight: number
    ) => {
      const words = text.split(" ");
      let line = "";
      const lines = [];
      for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + " ";
        const metrics = ctx.measureText(testLine);
        const testWidth = metrics.width;
        if (testWidth > maxWidth && n > 0) {
          lines.push(line);
          line = words[n] + " ";
        } else {
          line = testLine;
        }
      }
      lines.push(line);
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], x, y + i * lineHeight);
      }
    },
    []
  );

  const drawMessageWithFontResize = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      message: string,
      messageFont: string,
      baseFontSize: number,
      maxWidth: number,
      maxHeight: number,
      minFontSize: number // New parameter for configurable minimum font size
    ) => {
      // Calculate initial font size based on the component's width
      let fontSize = baseFontSize * (dimensions.width / 1920);

      // Ensure the font size is not larger than the base size
      fontSize = Math.min(fontSize, baseFontSize);

      // Use the provided minFontSize instead of a hard-coded value
      fontSize = Math.max(fontSize, minFontSize);

      ctx.font = `${fontSize}px ${messageFont}`;
      let textWidth = ctx.measureText(message).width;
      let textHeight = fontSize;

      // Reduce font size if text is too large, but not below minFontSize
      while (
        (textWidth > maxWidth || textHeight > maxHeight) &&
        fontSize > minFontSize
      ) {
        fontSize--;
        ctx.font = `${fontSize}px ${messageFont}`;
        textWidth = ctx.measureText(message).width;
        textHeight = fontSize;
      }

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      if (textWidth <= maxWidth) {
        ctx.fillText(message, dimensions.width / 2, dimensions.height / 2);
      } else {
        wrapText(
          ctx,
          message,
          dimensions.width / 2,
          dimensions.height / 2 - textHeight / 2,
          maxWidth,
          fontSize * 1.2
        );
      }
    },
    [dimensions, wrapText]
  );

  const animate = useCallback(
    (timestamp: number) => {
      if (!canvasRef.current || !offscreenCanvasRef.current) return;
      const ctx = canvasRef.current.getContext("2d");
      const offscreenCtx = offscreenCanvasRef.current.getContext("2d");
      if (!ctx || !offscreenCtx) return;
      const { width, height } = dimensions;
      const elapsed = timestamp - lastFrameTime.current;
      if (elapsed < 16) {
        animationRef.current = requestAnimationFrame(animate);
        return;
      }
      lastFrameTime.current = timestamp;
      ctx.clearRect(0, 0, width, height);
      offscreenCtx.clearRect(0, 0, width, height);
      try {
        drawSineWave(ctx, timestamp / 5);
        if (withBox) {
          drawMessageBox(offscreenCtx);
        }
        if (blurAmount > 0) {
          ctx.filter = `blur(${blurAmount}px)`;
        }
        ctx.drawImage(offscreenCanvasRef.current, 0, 0);
        ctx.filter = "none";
        ctx.fillStyle = textColor;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const maxWidth = Math.min(1200, width * 0.8);

        const maxHeight = height * 0.8;
        drawMessageWithFontResize(
          ctx,
          message,
          messageFont,
          messageFontSize,
          maxWidth,
          maxHeight,
          20
        );
      } catch (error) {
        console.error("Error in animation:", error);
      }
      animationRef.current = requestAnimationFrame(animate);
    },
    [
      dimensions,
      message,
      textColor,
      blurAmount,
      drawSineWave,
      drawMessageBox,
      withBox,
      drawMessageWithFontResize,
      messageFont,
      messageFontSize,
    ]
  );

  useEffect(() => {
    if (!canvasRef.current) return;
    canvasRef.current.width = dimensions.width;
    canvasRef.current.height = dimensions.height;
    offscreenCanvasRef.current = document.createElement("canvas");
    offscreenCanvasRef.current.width = dimensions.width;
    offscreenCanvasRef.current.height = dimensions.height;
    animationRef.current = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [dimensions, animate]);

  return <canvas ref={canvasRef} />;
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

export default SineWaveLoader;
