import { DoubleSide, Mesh, PlaneGeometry, ShaderMaterial } from 'three';
import type { AdapterFactory } from '../adapter';
import {
  sheetFragmentShader, sheetVertexShader, underneathFragmentShader,
} from '../vendor/codrops/unveilShaders';
import { createShaderStage, imageShader, screenVertexShader } from './shaderStage';

/** Unveil's real curled geometry and shading, ported from TSL to GLSL. */
export const createCodropsAdapter: AdapterFactory = (input) => createShaderStage(input, ({ uniforms, add }) => {
  const underneath = new ShaderMaterial({
    uniforms,
    vertexShader: screenVertexShader,
    fragmentShader: imageShader + underneathFragmentShader,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  const backing = new Mesh(new PlaneGeometry(1, 1), underneath);
  backing.renderOrder = 0;
  add(backing);
  const paper = new ShaderMaterial({
    uniforms,
    vertexShader: sheetVertexShader,
    fragmentShader: imageShader + sheetFragmentShader,
    side: DoubleSide,
    transparent: true,
  });
  const sheet = new Mesh(new PlaneGeometry(1, 1, 192, 120), paper);
  sheet.renderOrder = 1;
  sheet.frustumCulled = false;
  add(sheet, false);
});
