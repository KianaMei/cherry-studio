import React, { useState, useRef, useCallback, useEffect } from 'react'
import ReactCrop, { Crop, PixelCrop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import { Button, Slider, Space, Modal, Upload, message, Tooltip, Divider, InputNumber } from 'antd'
import { RotateCcw, RotateCw, FlipHorizontal, FlipVertical, Upload as UploadIcon, ZoomIn, ZoomOut, Undo2, Redo2 } from 'lucide-react'
import styled from 'styled-components'
import { useTranslation } from 'react-i18next'

interface ImageEditorProps {
  visible: boolean
  onCancel: () => void
  onConfirm: (editedImage: File) => void
  initialImage?: File | string
  aspectRatio?: number
}

interface ImageEditState {
  rotation: number
  visualRotation: number
  scaleX: number
  scaleY: number
  brightness: number
  contrast: number
  saturation: number
}

interface ViewTransform {
  scale: number
  offsetX: number
  offsetY: number
}

interface DragState {
  isDragging: boolean
  startX: number
  startY: number
  startOffsetX: number
  startOffsetY: number
}

interface EditorSnapshot {
  editState: ImageEditState
  viewTransform: ViewTransform
  crop?: Crop
}

const ImageEditor: React.FC<ImageEditorProps> = ({
  visible,
  onCancel,
  onConfirm,
  initialImage,
  aspectRatio,
}) => {
  const { t } = useTranslation()
  const [imageSrc, setImageSrc] = useState<string>('')
  const [crop, setCrop] = useState<Crop>()
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>()
  const [editState, setEditState] = useState<ImageEditState>({
    rotation: 0,
    visualRotation: 0,
    scaleX: 1,
    scaleY: 1,
    brightness: 100,
    contrast: 100,
    saturation: 100,
  })
  const [viewTransform, setViewTransform] = useState<ViewTransform>({ scale: 1, offsetX: 0, offsetY: 0 })
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    startX: 0,
    startY: 0,
    startOffsetX: 0,
    startOffsetY: 0,
  })
  const [isPanning, setIsPanning] = useState(false)
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })
  const [fitScale, setFitScale] = useState(1)
  const [undoStack, setUndoStack] = useState<EditorSnapshot[]>([])
  const [redoStack, setRedoStack] = useState<EditorSnapshot[]>([])

  const imgRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const onImageLoad = useCallback(() => {
    if (imgRef.current) {
      setNaturalSize({ width: imgRef.current.naturalWidth, height: imgRef.current.naturalHeight })
    }
  }, [])

  // Compute initial fit-to-cover scale and center image (preserve aspect ratio)
  const fitToContainer = useCallback(() => {
    const container = containerRef.current
    if (!container || naturalSize.width === 0 || naturalSize.height === 0) return
    const containerWidth = container.clientWidth
    const containerHeight = container.clientHeight
    if (containerWidth === 0 || containerHeight === 0) return

    const scaleW = containerWidth / naturalSize.width
    const scaleH = containerHeight / naturalSize.height
    const s = Math.max(scaleW, scaleH) // cover（按边铺满）
    // 初始进入按边长约 220%
    const TARGET_EDGE_RATIO = 2.2
    const INITIAL_ZOOM = TARGET_EDGE_RATIO
    setFitScale(s)
    setViewTransform({ scale: s * INITIAL_ZOOM, offsetX: 0, offsetY: 0 })
  }, [naturalSize.width, naturalSize.height])

  // After image natural size is known or modal becomes visible, fit once
  useEffect(() => {
    if (!visible) return
    // delay to ensure container layout settled
    const id = window.setTimeout(() => fitToContainer(), 50)
    return () => window.clearTimeout(id)
  }, [visible, fitToContainer])

  // Initialize or reset state when modal visibility or initial image changes
  useEffect(() => {
    if (initialImage && visible) {
      if (typeof initialImage === 'string') {
        setImageSrc(initialImage)
      } else {
        const reader = new FileReader()
        reader.onload = () => setImageSrc(reader.result as string)
        reader.readAsDataURL(initialImage)
      }
      // Reset editing state, but keep view transform for continuity
      setEditState({
        rotation: 0,
        visualRotation: 0,
        scaleX: 1,
        scaleY: 1,
        brightness: 100,
        contrast: 100,
        saturation: 100,
      })
    } else if (!visible) {
      // Clear state when modal is closed
      setImageSrc('')
      setCrop(undefined)
      setCompletedCrop(undefined)
    }
  }, [initialImage, visible])

  // Handle mouse wheel zoom (only with Ctrl/Cmd key) - zoom to cursor, keep focal point stable
  const handleWheel = useCallback((e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()

    const container = containerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    const cx = rect.width / 2
    const cy = rect.height / 2
    const px = mouseX - cx
    const py = mouseY - cy

    setViewTransform(prev => {
      const delta = e.deltaY > 0 ? -0.1 : 0.1
      // multiplicative zoom for smoothness
      const desired = prev.scale + delta * prev.scale
      const newScale = Math.max(fitScale * 0.02, Math.min(fitScale * 100, desired))
      if (Math.abs(newScale - prev.scale) < 1e-6) return prev

      const k = newScale / prev.scale
      // keep cursor-fixed point stable in container-centered coords
      const newOffsetX = k * prev.offsetX + (1 - k) * px
      const newOffsetY = k * prev.offsetY + (1 - k) * py
      return { scale: newScale, offsetX: newOffsetX, offsetY: newOffsetY }
    })
  }, [fitScale])

  // Handle pan with Pointer Events + pointer capture (more reliable than mouse events)
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!isPanning) return
    e.preventDefault()
    try {
      const el = e.currentTarget as HTMLElement
      el.setPointerCapture?.(e.pointerId)
    } catch {}
    setDragState({
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      startOffsetX: viewTransform.offsetX,
      startOffsetY: viewTransform.offsetY,
    })
  }, [isPanning, viewTransform.offsetX, viewTransform.offsetY])

  // Right-click cancels current crop selection
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    // 仅清除选区，不影响图片
    setCrop(undefined)
    setCompletedCrop(undefined)
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.isDragging) return
    e.preventDefault()
    
    // 使用 requestAnimationFrame 优化拖拽性能
    requestAnimationFrame(() => {
      const deltaX = e.clientX - dragState.startX
      const deltaY = e.clientY - dragState.startY
      setViewTransform(prev => ({
        ...prev,
        offsetX: dragState.startOffsetX + deltaX,
        offsetY: dragState.startOffsetY + deltaY,
      }))
    })
  }, [dragState])

  const handlePointerUp = useCallback((e?: React.PointerEvent) => {
    try {
      if (e) {
        const el = e.currentTarget as HTMLElement
        el.releasePointerCapture?.(e.pointerId)
      }
    } catch {}
    setDragState(prev => ({ ...prev, isDragging: false }))
  }, [])

  // Click/DoubleClick on empty background clears crop selection
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (!target.closest('.ReactCrop')) {
      setCrop(undefined)
      setCompletedCrop(undefined)
    }
  }, [])

  const handleContainerDoubleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (!target.closest('.ReactCrop')) {
      setCrop(undefined)
      setCompletedCrop(undefined)
    }
  }, [])

  // Handle spacebar for panning mode
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.code === 'Space' && !e.repeat) {
      e.preventDefault()
      setIsPanning(true)
    }
  }, [])

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    if (e.code === 'Space') {
      e.preventDefault()
      setIsPanning(false)
      setDragState(prev => ({ ...prev, isDragging: false }))
    }
  }, [])

  // Add and remove event listeners
  useEffect(() => {
    const container = containerRef.current
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false, capture: true })
    }
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('keyup', handleKeyUp)
    return () => {
      if (container) container.removeEventListener('wheel', handleWheel, true)
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('keyup', handleKeyUp)
    }
  }, [handleWheel, handleKeyDown, handleKeyUp])

  // Update cursor when dragging or panning
  useEffect(() => {
    if (containerRef.current) {
      if (dragState.isDragging) {
        containerRef.current.style.cursor = 'grabbing'
      } else if (isPanning) {
        containerRef.current.style.cursor = 'grab'
      } else {
        containerRef.current.style.cursor = 'default'
      }
    }
  }, [dragState.isDragging, isPanning])

  // Rotate image
  // 恒定步进 90°，视觉角度无限累加，动画时长恒定
  const ROTATION_STEP = 90
  const rotateImage = useCallback((degrees: number) => {
    const step = degrees > 0 ? ROTATION_STEP : -ROTATION_STEP
    setUndoStack(prev => [...prev, { editState, viewTransform, crop }])
    setRedoStack([])
    setEditState(prev => ({
      ...prev,
      rotation: (prev.rotation + step + 360) % 360,
      visualRotation: prev.visualRotation + step,
    }))
  }, [editState, viewTransform, crop])

  // Flip image
  const flipImage = useCallback((direction: 'horizontal' | 'vertical') => {
    setUndoStack(prev => [...prev, { editState, viewTransform, crop }])
    setRedoStack([])
    setEditState(prev => ({
      ...prev,
      [direction === 'horizontal' ? 'scaleX' : 'scaleY']:
        prev[direction === 'horizontal' ? 'scaleX' : 'scaleY'] * -1,
    }))
  }, [editState, viewTransform, crop])

  // Adjust image filters
  const adjustImage = useCallback((property: keyof ImageEditState, value: number) => {
    setEditState(prev => ({ ...prev, [property]: value }))
  }, [])

  // Commit adjust to history (invoke on slider release)
  // history helpers (used in UI handlers)
  const commitAdjustHistory = useCallback(() => {
    setUndoStack(prev => [...prev, { editState, viewTransform, crop }])
    setRedoStack([])
  }, [editState, viewTransform, crop])

  const handleUndo = useCallback(() => {
    setUndoStack(prev => {
      if (prev.length === 0) return prev
      const last = prev[prev.length - 1]
      setRedoStack(r => [...r, { editState, viewTransform, crop }])
      setEditState(last.editState)
      setViewTransform(last.viewTransform)
      setCrop(last.crop)
      setCompletedCrop(undefined)
      return prev.slice(0, -1)
    })
  }, [editState, viewTransform, crop])

  const handleRedo = useCallback(() => {
    setRedoStack(prev => {
      if (prev.length === 0) return prev
      const last = prev[prev.length - 1]
      setUndoStack(u => [...u, { editState, viewTransform, crop }])
      setEditState(last.editState)
      setViewTransform(last.viewTransform)
      setCrop(last.crop)
      setCompletedCrop(undefined)
      return prev.slice(0, -1)
    })
  }, [editState, viewTransform, crop])

  // Editable zoom percent
  const handleZoomPercentChange = useCallback((value: number | null) => {
    if (value == null || !isFinite(value)) return
    const percent = Math.max(2, Math.min(10000, value))
    const desiredScale = (percent / 100) * fitScale
    setUndoStack(prev => [...prev, { editState, viewTransform, crop }])
    setRedoStack([])
    setViewTransform(prev => {
      const newScale = Math.max(fitScale * 0.02, Math.min(fitScale * 100, desiredScale))
      const k = newScale / prev.scale
      return { ...prev, scale: newScale, offsetX: k * prev.offsetX, offsetY: k * prev.offsetY }
    })
  }, [fitScale, editState, viewTransform, crop])

  // Zoom controls
  const zoomIn = useCallback(() => {
    setUndoStack(prev => [...prev, { editState, viewTransform, crop }])
    setRedoStack([])
    setViewTransform(prev => {
      const desired = prev.scale * 1.1
      const newScale = Math.max(fitScale * 0.02, Math.min(fitScale * 100, desired))
      if (Math.abs(newScale - prev.scale) < 1e-6) return prev
      const k = newScale / prev.scale
      return { ...prev, scale: newScale, offsetX: k * prev.offsetX, offsetY: k * prev.offsetY }
    })
  }, [fitScale, editState, viewTransform, crop])

  const zoomOut = useCallback(() => {
    setUndoStack(prev => [...prev, { editState, viewTransform, crop }])
    setRedoStack([])
    setViewTransform(prev => {
      const desired = prev.scale / 1.1
      const newScale = Math.max(fitScale * 0.02, Math.min(fitScale * 100, desired))
      if (Math.abs(newScale - prev.scale) < 1e-6) return prev
      const k = newScale / prev.scale
      return { ...prev, scale: newScale, offsetX: k * prev.offsetX, offsetY: k * prev.offsetY }
    })
  }, [fitScale, editState, viewTransform, crop])

  // Reset all edits to initial state
  const resetAll = useCallback(() => {
    setUndoStack(prev => [...prev, { editState, viewTransform, crop }])
    setRedoStack([])
    setEditState({
      rotation: 0,
      visualRotation: 0,
      scaleX: 1,
      scaleY: 1,
      brightness: 100,
      contrast: 100,
      saturation: 100,
    })
    setViewTransform({ scale: 1, offsetX: 0, offsetY: 0 })
    setCrop(undefined)
    setCompletedCrop(undefined)
  }, [editState, viewTransform, crop])

  // Generate the final edited image file
  const generateEditedImage = useCallback(async (): Promise<File | null> => {
    const image = imgRef.current
    if (!image) {
      message.error('图片不可用')
      return null
    }

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      message.error('创建画布失败')
      return null
    }

    let cropX = 0
    let cropY = 0
    let cropWidth = image.naturalWidth
    let cropHeight = image.naturalHeight

    // 优先使用百分比裁剪，避免受任何视觉缩放/变换影响
    if (crop && (crop.width || 0) > 0 && (crop.height || 0) > 0) {
      cropX = ((crop.x || 0) / 100) * image.naturalWidth
      cropY = ((crop.y || 0) / 100) * image.naturalHeight
      cropWidth = ((crop.width || 0) / 100) * image.naturalWidth
      cropHeight = ((crop.height || 0) / 100) * image.naturalHeight
    } else if (completedCrop && completedCrop.width > 0 && completedCrop.height > 0) {
      // 兜底：像素裁剪，按元素自身宽高与 natural 尺寸换算
      const displayedWidth = image.naturalWidth // 我们不再修改 <img> 宽度，避免误差
      const displayedHeight = image.naturalHeight
      const scaleX = image.naturalWidth / displayedWidth
      const scaleY = image.naturalHeight / displayedHeight
      cropX = completedCrop.x * scaleX
      cropY = completedCrop.y * scaleY
      cropWidth = completedCrop.width * scaleX
      cropHeight = completedCrop.height * scaleY
    }

    canvas.width = cropWidth
    canvas.height = cropHeight

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.save()

    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((editState.rotation * Math.PI) / 180)
    ctx.scale(editState.scaleX, editState.scaleY)
    ctx.filter = `brightness(${editState.brightness}%) contrast(${editState.contrast}%) saturate(${editState.saturation}%)`

    ctx.drawImage(
      image,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      -cropWidth / 2,
      -cropHeight / 2,
      cropWidth,
      cropHeight
    )

    ctx.restore()

    return new Promise(resolve => {
      canvas.toBlob(blob => {
        if (blob) {
          const file = new File([blob], 'edited-image.png', { type: 'image/png' })
          resolve(file)
        } else {
          message.error('生成图片失败')
          resolve(null)
        }
      }, 'image/png', 0.9)
    })
  }, [completedCrop, editState])

  // Handle confirm button click
  const handleConfirm = async () => {
    const editedImage = await generateEditedImage()
    if (editedImage) {
      onConfirm(editedImage)
    }
  }

  // Handle file upload
  const handleFileUpload = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => setImageSrc(reader.result as string)
    reader.readAsDataURL(file)
    return false
  }

  return (
    <Modal
      title={t('imageEditor.title', '编辑图片')}
      open={visible}
      onCancel={onCancel}
      onOk={handleConfirm}
      width="90vw"
      style={{ maxWidth: 1200 }}
      centered
      okText={t('imageEditor.confirm', '确认编辑')}
      cancelText={t('common.cancel', '取消')}
      maskClosable={false}
      keyboard={false}
      destroyOnClose
    >
      <Container>
        <EditorSection>
          <ImageContainer
            ref={containerRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onContextMenu={handleContextMenu}
            onClick={handleContainerClick}
            onDoubleClick={handleContainerDoubleClick}
            style={{
              ['--imgScale' as any]: viewTransform.scale,
            }}
          >
            {imageSrc ? (
              <ImageWrapper
                style={{
                  transform: `translate(-50%, -50%) translate(${viewTransform.offsetX}px, ${viewTransform.offsetY}px) scale(${viewTransform.scale}) rotate(${editState.visualRotation}deg)`,
                }}
              >
                <ReactCrop
                  crop={crop}
                  onChange={(_, percentCrop) => setCrop(percentCrop)}
                  onComplete={c => setCompletedCrop(c)}
                  aspect={typeof aspectRatio === 'number' && aspectRatio > 0 ? aspectRatio : undefined}
                  minWidth={50}
                  minHeight={50}
                  disabled={isPanning}
                  ruleOfThirds
                >
                  <VisibleImage
                    ref={imgRef}
                    src={imageSrc}
                    style={{
                      transform: `scaleX(${editState.scaleX}) scaleY(${editState.scaleY})`,
                      filter: `brightness(${editState.brightness}%) contrast(${editState.contrast}%) saturate(${editState.saturation}%)`,
                      transformOrigin: 'center center',
                    }}
                    onLoad={onImageLoad}
                    crossOrigin="anonymous"
                  />
                </ReactCrop>
              </ImageWrapper>
            ) : (
              <UploadArea>
                <Upload
                  accept="image/*"
                  beforeUpload={handleFileUpload}
                  showUploadList={false}
                >
                  <div style={{ textAlign: 'center' }}>
                    <UploadIcon size={48} style={{ color: '#888', marginBottom: 16 }} />
                    <div>{t('imageEditor.uploadHint', '点击上传图片')}</div>
                  </div>
                </Upload>
              </UploadArea>
            )}
          </ImageContainer>

          <ControlsContainer>
            <HelpText>
              {t('imageEditor.helpText', '提示：按住空格键并拖动鼠标可平移图片，按住Ctrl/Cmd并滚动鼠标可缩放图片，鼠标左键裁剪，右键取消选中。')}
            </HelpText>

            <ControlGroup>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                <ControlLabel style={{ margin: 0 }}>{t('imageEditor.zoom', '缩放')}</ControlLabel>
                <Space size={6} align="center">
                  <Tooltip title={t('imageEditor.zoomOut', '缩小')}>
                    <Button size="small" shape="circle" icon={<ZoomOut size={14} />} onClick={zoomOut} />
                  </Tooltip>
                  <Tooltip title={t('imageEditor.zoomIn', '放大')}>
                    <Button size="small" shape="circle" icon={<ZoomIn size={14} />} onClick={zoomIn} />
                  </Tooltip>
                  <Divider type="vertical" style={{ margin: '0 4px' }} />
                  <InputNumber
                    size="small"
                    value={Math.round((viewTransform.scale / fitScale) * 100)}
                    min={2}
                    max={10000}
                    formatter={v => `${v}%`}
                    parser={v => Number(String(v).replace('%', ''))}
                    onPressEnter={e => {
                      const val = Number((e.target as HTMLInputElement).value.replace('%', ''))
                      handleZoomPercentChange(isNaN(val) ? 100 : val)
                    }}
                    onBlur={e => {
                      const val = Number((e.target as HTMLInputElement).value.replace('%', ''))
                      handleZoomPercentChange(isNaN(val) ? 100 : val)
                    }}
                    style={{ width: 84 }}
                  />
                </Space>
              </div>
            </ControlGroup>

            <ControlGroup>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                <ControlLabel style={{ margin: 0 }}>{t('imageEditor.actions', '操作')}</ControlLabel>
                <Space size={6}>
                  <Tooltip title={t('common.undo', '上一步')}>
                    <Button size="small" shape="circle" icon={<Undo2 size={14} />} onClick={handleUndo} disabled={undoStack.length === 0} />
                  </Tooltip>
                  <Tooltip title={t('common.redo', '下一步')}>
                    <Button size="small" shape="circle" icon={<Redo2 size={14} />} onClick={handleRedo} disabled={redoStack.length === 0} />
                  </Tooltip>
                  <Button size="small" type="link" onClick={resetAll}>{t('imageEditor.reset', '重置')}</Button>
                </Space>
              </div>
            </ControlGroup>

            <ControlGroup>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <ControlLabel style={{ margin: 0 }}>{t('imageEditor.rotateFlip', '旋转与翻转')}</ControlLabel>
                <Space size={6} wrap>
                  <Tooltip title={t('imageEditor.rotateLeft', '左转90°')}>
                    <Button size="small" shape="circle" icon={<RotateCcw size={14} />} onClick={() => rotateImage(-90)} />
                  </Tooltip>
                  <Tooltip title={t('imageEditor.rotateRight', '右转90°')}>
                    <Button size="small" shape="circle" icon={<RotateCw size={14} />} onClick={() => rotateImage(90)} />
                  </Tooltip>
                  <Tooltip title={t('imageEditor.flipHorizontal', '水平翻转')}>
                    <Button size="small" shape="circle" icon={<FlipHorizontal size={14} />} onClick={() => flipImage('horizontal')} />
                  </Tooltip>
                  <Tooltip title={t('imageEditor.flipVertical', '垂直翻转')}>
                    <Button size="small" shape="circle" icon={<FlipVertical size={14} />} onClick={() => flipImage('vertical')} />
                  </Tooltip>
                </Space>
              </div>
            </ControlGroup>

            <ControlGroup>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ControlLabel style={{ margin: 0, whiteSpace: 'nowrap' }}>{t('imageEditor.brightness', '亮度')}: {editState.brightness - 100}</ControlLabel>
                <div style={{ flex: 1 }}>
                  <Slider
                    min={0}
                    max={200}
                    value={editState.brightness}
                    onChange={value => adjustImage('brightness', value)}
                    onAfterChange={commitAdjustHistory}
                    style={{ width: '100%' }}
                    tooltip={{ formatter: value => `${(value || 0) - 100}` }}
                  />
                </div>
              </div>
            </ControlGroup>

            <ControlGroup>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ControlLabel style={{ margin: 0, whiteSpace: 'nowrap' }}>{t('imageEditor.contrast', '对比度')}: {editState.contrast - 100}</ControlLabel>
                <div style={{ flex: 1 }}>
                  <Slider
                    min={0}
                    max={200}
                    value={editState.contrast}
                    onChange={value => adjustImage('contrast', value)}
                    onAfterChange={commitAdjustHistory}
                    style={{ width: '100%' }}
                    tooltip={{ formatter: value => `${(value || 0) - 100}` }}
                  />
                </div>
              </div>
            </ControlGroup>

            <ControlGroup>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ControlLabel style={{ margin: 0, whiteSpace: 'nowrap' }}>{t('imageEditor.saturation', '饱和度')}: {editState.saturation - 100}</ControlLabel>
                <div style={{ flex: 1 }}>
                  <Slider
                    min={0}
                    max={200}
                    value={editState.saturation}
                    onChange={value => adjustImage('saturation', value)}
                    onAfterChange={commitAdjustHistory}
                    style={{ width: '100%' }}
                    tooltip={{ formatter: value => `${(value || 0) - 100}` }}
                  />
                </div>
              </div>
            </ControlGroup>
          </ControlsContainer>
        </EditorSection>
      </Container>
    </Modal>
  )
}

// --- Styled Components ---

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
  height: 60vh;
  min-height: 550px;
`

const EditorSection = styled.div`
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 24px;
  flex: 1;
  min-height: 0;
`

const ImageContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #d9d9d9;
  border-radius: 8px;
  background: #f5f5f5;
  overflow: hidden;
  position: relative;
  touch-action: none;
  padding: 10px;

  /* Normalize ReactCrop internal sizes to be inverse of the image scale */
  .ReactCrop {
    --rc-drag-handle-size: calc(12px / var(--imgScale));
    --rc-drag-handle-mobile-size: calc(24px / var(--imgScale));
    --rc-drag-bar-size: calc(6px / var(--imgScale));
  }

  /* keep crop UI static by inversely scaling with wrapper's CSS variable */
  .ReactCrop__crop-selection {
    border: calc(0.5px / var(--imgScale)) solid rgba(255, 255, 255, 0.9);
    box-shadow: 0 0 0 9999em rgba(0, 0, 0, 0.3);
    /* Override marching-ants background thickness */
    background-size:
      calc(10px / var(--imgScale)) calc(1px / var(--imgScale)),
      calc(10px / var(--imgScale)) calc(1px / var(--imgScale)),
      calc(1px / var(--imgScale)) calc(10px / var(--imgScale)),
      calc(1px / var(--imgScale)) calc(10px / var(--imgScale));
  }

  .ReactCrop__drag-handle {
    width: calc(6px / var(--imgScale));
    height: calc(6px / var(--imgScale));
    background-color: #fff;
    border: calc(0.5px / var(--imgScale)) solid #1890ff;
    border-radius: 50%;
  }

  /* Keep rule-of-thirds lines thin */
  .ReactCrop__rule-of-thirds-vt:before,
  .ReactCrop__rule-of-thirds-vt:after {
    width: calc(1px / var(--imgScale));
  }

  .ReactCrop__rule-of-thirds-hz:before,
  .ReactCrop__rule-of-thirds-hz:after {
    height: calc(1px / var(--imgScale));
  }
`

const VisibleImage = styled.img`
  max-width: none;
  max-height: none;
  user-select: none;
  transition: transform 0.1s ease-out;
`

const UploadArea = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  cursor: pointer;
  border-radius: 8px;
  transition: background-color 0.2s;

  &:hover {
    background: #fafafa;
  }
`

const ControlsContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-top: 10px;
  overflow-y: auto;
  padding-right: 10px;
`

const ControlGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const ControlLabel = styled.label`
  font-size: 14px;
  font-weight: 500;
  color: #333;
`

const ImageWrapper = styled.div`
  display: inline-block;
  position: absolute;
  left: 50%;
  top: 50%;
  user-select: none;
  /* 统一控制旋转动画时长与节奏 */
  transition: transform 0.18s ease-in-out;
`

const HelpText = styled.div`
  font-size: 12px;
  color: #666;
  background: rgba(0, 0, 0, 0.05);
  padding: 8px 12px;
  border-radius: 4px;
  margin-bottom: 16px;
  line-height: 1.6;

  kbd {
    display: inline-block;
    padding: 2px 4px;
    font-size: 11px;
    line-height: 1;
    color: #444;
    background-color: #fafafa;
    border: 1px solid #ccc;
    border-radius: 3px;
    box-shadow: inset 0 -1px 0 #bbb;
    font-family: monospace;
  }
`

export default ImageEditor