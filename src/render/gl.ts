import type { ThemeRuntime } from './themes';

export const FULLSCREEN_VS = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/** Shared fragment shader prelude: precision, palette lookup with ping-pong cycling. */
export const FS_PRELUDE = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uTime;
uniform sampler2D uPal;
uniform float uShift;
uniform vec3 uBg;
vec3 pal(float t) {
  float x = 1.0 - abs(mod(t + uShift, 2.0) - 1.0);
  return texture2D(uPal, vec2(x * (255.0 / 256.0) + 0.5 / 256.0, 0.5)).rgb;
}
`;

export class Program {
  readonly program: WebGLProgram;
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  private gl: WebGLRenderingContext;

  constructor(gl: WebGLRenderingContext, vs: string, fs: string) {
    this.gl = gl;
    const p = gl.createProgram();
    if (!p) throw new Error('createProgram failed');
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(`Program link failed: ${gl.getProgramInfoLog(p)}`);
    }
    this.program = p;
  }

  use(): void {
    this.gl.useProgram(this.program);
  }

  loc(name: string): WebGLUniformLocation | null {
    let l = this.uniforms.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.program, name);
      this.uniforms.set(name, l);
    }
    return l;
  }

  f1(name: string, v: number): void {
    this.gl.uniform1f(this.loc(name), v);
  }
  f2(name: string, a: number, b: number): void {
    this.gl.uniform2f(this.loc(name), a, b);
  }
  f3(name: string, a: number, b: number, c: number): void {
    this.gl.uniform3f(this.loc(name), a, b, c);
  }
  i1(name: string, v: number): void {
    this.gl.uniform1i(this.loc(name), v);
  }

  dispose(): void {
    this.gl.deleteProgram(this.program);
  }
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error('createShader failed');
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(s)}`);
  }
  return s;
}

/** A single full-screen triangle (cheaper than a quad, no diagonal seam). */
export class FullscreenTriangle {
  private buf: WebGLBuffer | null;
  constructor(private gl: WebGLRenderingContext) {
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  }
  draw(): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  dispose(): void {
    this.gl.deleteBuffer(this.buf);
  }
}

/** The active theme palette as a 256×1 texture, re-uploaded on change. */
export class PaletteTexture {
  readonly tex: WebGLTexture | null;
  private version = -1;
  private data = new Uint8Array(256 * 4);

  constructor(private gl: WebGLRenderingContext) {
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  bind(theme: ThemeRuntime, unit = 0): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    if (theme.version !== this.version) {
      this.version = theme.version;
      for (let i = 0; i < 256; i++) {
        this.data[i * 4] = theme.lut[i * 3];
        this.data[i * 4 + 1] = theme.lut[i * 3 + 1];
        this.data[i * 4 + 2] = theme.lut[i * 3 + 2];
        this.data[i * 4 + 3] = 255;
      }
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.data);
    }
  }

  dispose(): void {
    this.gl.deleteTexture(this.tex);
  }
}

/** Helper that bundles program + triangle + palette for full-screen shader modes. */
export class ShaderPass {
  readonly program: Program;
  private tri: FullscreenTriangle;
  private palette: PaletteTexture;

  constructor(gl: WebGLRenderingContext, fragment: string) {
    this.program = new Program(gl, FULLSCREEN_VS, FS_PRELUDE + fragment);
    this.tri = new FullscreenTriangle(gl);
    this.palette = new PaletteTexture(gl);
  }

  /** Bind program, palette and the common uniforms. Returns the program for extra uniforms. */
  begin(gl: WebGLRenderingContext, w: number, h: number, time: number, theme: ThemeRuntime): Program {
    const p = this.program;
    gl.viewport(0, 0, w, h);
    p.use();
    this.palette.bind(theme, 0);
    p.i1('uPal', 0);
    p.f2('uRes', w, h);
    p.f1('uTime', time);
    p.f1('uShift', theme.cycleSpeed > 0 ? theme.shift : 0);
    const [r, g, b] = theme.bgRgb;
    p.f3('uBg', r / 255, g / 255, b / 255);
    return p;
  }

  draw(): void {
    this.tri.draw();
  }

  dispose(): void {
    this.program.dispose();
    this.tri.dispose();
    this.palette.dispose();
  }
}
