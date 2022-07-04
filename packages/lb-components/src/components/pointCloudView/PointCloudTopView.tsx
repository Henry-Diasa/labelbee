/*
 * @Author: Laoluo luozefeng@sensetime.com
 * @Date: 2022-06-22 11:08:31
 * @LastEditors: Laoluo luozefeng@sensetime.com
 * @LastEditTime: 2022-07-04 17:34:17
 */
import { ISize } from '@/types/main';
import { getClassName } from '@/utils/dom';
import {
  PolygonOperation,
  cTool,
  CanvasSchduler,
  PointCloud,
  MathUtils,
} from '@labelbee/lb-annotation';
import { EPerspectiveView, IPointCloudBox } from '@labelbee/lb-utils';
import React, { useEffect, useRef, useState } from 'react';
import { pointCloudMain } from './PointCloud3DView';
import { PointCloudContext } from './PointCloudContext';
import { PointCloudContainer } from './PointCloudLayout';
import { SidePointCloud, SidePointCloudPolygonOperation } from './PointCloudSideView';

const { EPolygonPattern } = cTool;

const CreateEmptyImage = (size: { width: number; height: number }) => {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, size.width, size.height);
    return canvas.toDataURL();
  }
  return '';
};

/**
 * Get the offset from canvas2d-coordinate to world coordinate
 * @param currentPos
 * @param size
 * @param zoom
 * @returns
 */
const TransferCanvas2WorldOffset = (
  currentPos: { x: number; y: number },
  size: { width: number; height: number },
  zoom = 1,
) => {
  const { width: w, height: h } = size;

  const canvasCenterPoint = {
    x: currentPos.x + (w * zoom) / 2,
    y: currentPos.y + (h * zoom) / 2,
  };

  const worldCenterPoint = {
    x: size.width / 2,
    y: size.height / 2,
  };

  return {
    offsetX: (worldCenterPoint.x - canvasCenterPoint.x) / zoom,
    offsetY: -(worldCenterPoint.y - canvasCenterPoint.y) / zoom,
  };
};

/**
 * Get the coordinate from canvas2d-coordinate to world coordinate
 */
const TransferCanvas2World = (
  currentPos: { x: number; y: number },
  size: { width: number; height: number },
) => {
  const { width: w, height: h } = size;
  const { x, y } = currentPos;

  // x-Axis is the Positive Direction, so the x-coordinates need to be swapped with the y-coordinates
  return {
    x: -y + h / 2,
    y: -(x - w / 2),
  };
};

let TopPointCloud: any;
let TopPointCloudPolygonOperation: any;

const PointCloudTopView = () => {
  const ref = useRef<HTMLDivElement>(null);
  const plgOpraRef = useRef<PolygonOperation | null>();
  const ptCtx = React.useContext(PointCloudContext);
  const pointCloudRef = useRef<PointCloud | null>();

  const [, setImgInfo] = useState({ width: 0, height: 0 });

  const mainViewGenBox = (boxParams: IPointCloudBox, polygonID: string) => {
    pointCloudMain.generateBox(boxParams, polygonID);
    pointCloudMain.controls.update();
    pointCloudMain.render();
  };

  const topViewPolygon2PointCloud = (
    newPolygon: any,
    pointCloud: PointCloud,
    mockImgInfo: ISize,
  ) => {
    const [point1, point2, point3, point4] = newPolygon.pointList.map((v: any) =>
      TransferCanvas2World(v, mockImgInfo),
    );

    const centerPoint = MathUtils.getLineCenterPoint([point1, point3]);
    const height = MathUtils.getLineLength(point1, point2);
    const width = MathUtils.getLineLength(point2, point3);

    const rotation = MathUtils.getRadiusFromQuadrangle(newPolygon.pointList);
    const zInfo = pointCloud.getSensesPointZAxisInPolygon([point1, point2, point3, point4]);

    const boxParams: IPointCloudBox = {
      center: {
        x: centerPoint.x,
        y: centerPoint.y,
        z: (zInfo.maxZ + zInfo.minZ) / 2,
      },
      width,
      height,
      depth: zInfo.maxZ - zInfo.minZ,
      rotation,
      id: newPolygon.id,
      attribute: '',
      valid: true,
      // TODO: fix trackID
      trackID: 0,
    };

    return boxParams;
  };

  const afterPolygonCreated = (newPolygon: any, pointCloud: PointCloud, mockImgInfo: ISize) => {
    const newParams = topViewPolygon2PointCloud(newPolygon, pointCloud, mockImgInfo);
    ptCtx.setPointCloudResult(ptCtx.pointCloudBoxList.concat(newParams));
    ptCtx.setSelectedID(newParams.id);

    mainViewGenBox(newParams, newPolygon.id);

    // Set Box data
    SidePointCloud.setTemplateBox(newParams);
    TopPointCloud.setTemplateBox(newParams);

    return {
      boxParams: newParams,
    };
  };

  /**
   *
   * @param boxParams
   * @param newPolygon TODO！ Need to add type
   */
  const synchronizeSideView = (boxParams: IPointCloudBox, newPolygon: any, isInit = false) => {
    /**
     * TEMPLATE - Will be deleted.
     * For confirming the location.
     */
    SidePointCloud.generateBox(boxParams, newPolygon.id);

    // Create PointCloud
    SidePointCloud.loadPCDFileByBox('http://10.53.25.142:8001/1/000001.pcd', boxParams);
    const { cameraPositionVector } = SidePointCloud.updateOrthoCamera(
      boxParams,
      EPerspectiveView.Left,
    );

    if (isInit) {
      SidePointCloud.setCacheCameraPosition(cameraPositionVector);
    }

    // Create Draw Polygon
    const { polygon2d, zoom } = SidePointCloud.getBoxSidePolygon2DCoordinate(boxParams);

    // Synchronize SidePointCloud zoom with PolygonOperation
    SidePointCloud.camera.zoom = zoom;
    SidePointCloud.camera.updateProjectionMatrix();
    SidePointCloud.render();

    // Update PolygonView to default zoom and currentPos.
    SidePointCloudPolygonOperation.initPosition();
    SidePointCloudPolygonOperation.zoomChangeOnCenter(zoom);
    SidePointCloudPolygonOperation.setResult([
      {
        id: newPolygon.id,
        pointList: polygon2d,
        textAttribute: '',
        isRect: true,
      },
    ]);
  };

  useEffect(() => {
    if (ref.current) {
      const mockImgInfo = {
        width: ref.current.clientWidth,
        height: ref.current.clientHeight,
      };
      setImgInfo(mockImgInfo);

      const defaultOrthographic = {
        left: -mockImgInfo.width / 2,
        right: mockImgInfo.width / 2,
        top: mockImgInfo.height / 2,
        bottom: -mockImgInfo.height / 2,
        near: 100,
        far: -100,
      };

      const container = ref.current;
      const imgSrc = CreateEmptyImage(mockImgInfo);

      const image = new Image();
      image.src = imgSrc;
      image.onload = () => {
        const canvasSchuler = new CanvasSchduler({ container });
        const pointCloud = new PointCloud({
          container,
          noAppend: true,
          isOrthographicCamera: true,
          orthgraphicParams: defaultOrthographic,
        });

        pointCloudRef.current = pointCloud;
        pointCloud.loadPCDFile('http://10.53.25.142:8001/1/000001.pcd');

        // TODO.
        TopPointCloud = pointCloud;
        canvasSchuler.createCanvas(pointCloud.renderer.domElement);

        const polygonOperation = new PolygonOperation({
          container: ref.current as HTMLDivElement,
          size: mockImgInfo,
          config: '{ textConfigurable: false }',
          imgNode: image,
          isAppend: false,
        });

        plgOpraRef.current = polygonOperation;

        polygonOperation.eventBinding();
        polygonOperation.setPattern(EPolygonPattern.Rect);
        polygonOperation.on('polygonCreated', (polygon: any) => {
          const { boxParams } = afterPolygonCreated(polygon, pointCloud, mockImgInfo);
          synchronizeSideView(boxParams, polygon, true);
        });

        polygonOperation.on('selectedChange', () => {
          const selectedID = polygonOperation.selectedID;
          ptCtx.setSelectedID(selectedID ?? '');
        });

        TopPointCloudPolygonOperation = polygonOperation;

        /**
         * Synchronized 3d point cloud view displacement operations
         *
         * Change Orthographic Camera size
         */
        polygonOperation.on('renderZoom', (zoom: number, currentPos: any) => {
          const { offsetX, offsetY } = TransferCanvas2WorldOffset(currentPos, mockImgInfo, zoom);
          pointCloud.camera.zoom = zoom;
          if (currentPos) {
            const { x, y, z } = TopPointCloud.cacheCameraPosition;
            TopPointCloud.camera.position.set(x + offsetY, y - offsetX, z);
          }

          pointCloud.camera.updateProjectionMatrix();

          pointCloud.render();
        });

        // Synchronized 3d point cloud view displacement operations
        polygonOperation.on('dragMove', ({ currentPos, zoom }) => {
          const { offsetX, offsetY } = TransferCanvas2WorldOffset(currentPos, mockImgInfo, zoom);
          pointCloud.camera.zoom = zoom;
          const { x, y, z } = TopPointCloud.cacheCameraPosition;
          TopPointCloud.camera.position.set(x + offsetY, y - offsetX, z);
          pointCloud.render();
        });

        polygonOperation.on('updatePolygonByDrag', ({ newPolygon }: any) => {
          const newParams = topViewPolygon2PointCloud(newPolygon, pointCloud, mockImgInfo);
          newParams.depth = TopPointCloud.templateBox.depth;
          newParams.center.z = TopPointCloud.templateBox.center.z;

          mainViewGenBox(newParams, newPolygon.id);

          // Init SidePointCloud, focus on the box
          SidePointCloud.updateOrthoCamera(newParams, EPerspectiveView.Left);
          SidePointCloud.render();

          SidePointCloud.setTemplateBox(newParams);
          TopPointCloud.setTemplateBox(newParams);
          const { polygon2d, zoom } = SidePointCloud.getBoxSidePolygon2DCoordinate(newParams);

          SidePointCloudPolygonOperation.initPosition();
          SidePointCloudPolygonOperation.zoomChangeOnCenter(zoom);

          // TODO, It need to synchronize polygonOperation
          SidePointCloudPolygonOperation.setResult([
            {
              id: newPolygon.id,
              pointList: polygon2d,
              textAttribute: '',
              isRect: true,
            },
          ]);

          SidePointCloud.camera.zoom = zoom;
          SidePointCloud.camera.updateProjectionMatrix();
          SidePointCloud.render();
        });

        canvasSchuler.createCanvas(polygonOperation.canvas, { size: mockImgInfo });
      };
    }
  }, []);

  useEffect(() => {
    if (plgOpraRef.current) {
      plgOpraRef.current.on('polygonCreated', (polygon: any) => {
        if (pointCloudRef.current && ref.current) {
          const { boxParams } = afterPolygonCreated(polygon, TopPointCloud, {
            width: ref.current.clientWidth,
            height: ref.current.clientHeight,
          });
          synchronizeSideView(boxParams, polygon, true);
        }
      });
    }
  }, [ptCtx]);

  return (
    <PointCloudContainer
      className={getClassName('point-cloud-container', 'top-view')}
      title='俯视图'
    >
      <div style={{ width: '100%', height: 500 }} ref={ref} />
    </PointCloudContainer>
  );
};

export default PointCloudTopView;

export { TopPointCloudPolygonOperation, TopPointCloud };
