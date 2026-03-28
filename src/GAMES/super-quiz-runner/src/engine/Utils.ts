
export function clamp(v: number, a: number, b: number){ return Math.max(a, Math.min(b, v)); }
export function random(min: number, max: number) { return Math.random() * (max - min) + min; }
export function randomInt(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number = 6, fill: boolean, stroke: boolean){
    ctx.beginPath();
    ctx.moveTo(x+r, y); ctx.arcTo(x+w, y, x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x, y+h, r); ctx.arcTo(x, y+h, x, y, r);
    ctx.arcTo(x, y, x+w, y, r); ctx.closePath();
    if(fill) ctx.fill();
    if(stroke) ctx.stroke();
}

export function wrapText(context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number){
    const words = text.split(' ');
    let line = '';
    for(let n=0;n<words.length;n++){
        const testLine = line + words[n] + ' ';
        const metrics = context.measureText(testLine);
        if(metrics.width > maxWidth && n > 0){
            context.fillText(line, x, y);
            line = words[n] + ' ';
            y += lineHeight;
        } else line = testLine;
    }
    context.fillText(line, x, y);
}

// ... All entities will be implemented next, but I need to split this file otherwise it's 2000 lines
