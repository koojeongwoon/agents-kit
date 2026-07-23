import express from 'express';
import fs from 'fs';
import path from 'path';
import {assertWithinRoots} from '../../../lib/security-boundary.js';
import {sendBadRequest, sendServerError} from '../../../lib/interfaces/http/error-mapper.js';

export function createFilesRouter(ctx) {
  const router = express.Router();
  const { kitRoot, readableRoots, resolveDocumentPath } = ctx;

  // GET /api/file-preview
  router.get('/api/file-preview', (req, res) => {
    const filePath = req.query.path;
    if (!filePath) return sendBadRequest(res, 'Path is required');

    try {
      assertWithinRoots(filePath, readableRoots(), 'file preview');
      const targetFileToRead = resolveDocumentPath(filePath);
      assertWithinRoots(targetFileToRead, readableRoots(), 'file preview');
      let isBakFile = false;

      if (!fs.existsSync(targetFileToRead)) {
        if (fs.existsSync(`${filePath}.bak`)) {
          const bakResolved = resolveDocumentPath(`${filePath}.bak`);
          const content = fs.readFileSync(bakResolved, 'utf-8');
          return res.json({ exists: true, isBakFile: true, readPath: bakResolved, content, message: '백업(.bak) 파일의 내용입니다.' });
        } else {
          return res.json({ exists: false, content: '', message: '파일이 존재하지 않습니다.' });
        }
      }

      const content = fs.readFileSync(targetFileToRead, 'utf-8');
      res.json({
        exists: true,
        isBakFile,
        readPath: targetFileToRead,
        content,
        message: '자원 지침서 내용입니다.'
      });
    } catch (err) {
      sendServerError(res, err);
    }
  });

  // GET /api/diff-preview
  router.get('/api/diff-preview', (req, res) => {
    const { targetPath, sourcePath } = req.query;
    if (!targetPath || !sourcePath) {
      return sendBadRequest(res, 'targetPath and sourcePath are required');
    }

    try {
      assertWithinRoots(targetPath, readableRoots(), 'diff target');
      assertWithinRoots(sourcePath, [kitRoot], 'diff source');
      const resolvedTarget = resolveDocumentPath(targetPath);
      const resolvedSource = resolveDocumentPath(sourcePath);
      assertWithinRoots(resolvedTarget, readableRoots(), 'diff target');
      assertWithinRoots(resolvedSource, [kitRoot], 'diff source');

      let existingContent = '';
      let hasExisting = false;

      if (fs.existsSync(targetPath)) {
        const lstat = fs.lstatSync(targetPath);
        if (!lstat.isSymbolicLink()) {
          existingContent = fs.readFileSync(resolvedTarget, 'utf-8');
          hasExisting = true;
        } else if (fs.existsSync(`${targetPath}.bak`)) {
          const bakResolved = resolveDocumentPath(`${targetPath}.bak`);
          existingContent = fs.readFileSync(bakResolved, 'utf-8');
          hasExisting = true;
        }
      } else if (fs.existsSync(`${targetPath}.bak`)) {
        const bakResolved = resolveDocumentPath(`${targetPath}.bak`);
        existingContent = fs.readFileSync(bakResolved, 'utf-8');
        hasExisting = true;
      }

      let masterContent = '';
      if (fs.existsSync(resolvedSource)) {
        masterContent = fs.readFileSync(resolvedSource, 'utf-8');
      }

      res.json({
        success: true,
        hasExisting,
        existingContent,
        masterContent,
        resolvedSource,
        resolvedTarget
      });
    } catch (err) {
      sendServerError(res, err);
    }
  });

  // POST /api/save-asset-content
  router.post('/api/save-asset-content', (req, res) => {
    const { path: filePath, content } = req.body;
    if (!filePath || content === undefined) {
      return sendBadRequest(res, 'Path and content are required');
    }

    try {
      assertWithinRoots(filePath, [kitRoot], 'save asset');
      const targetPath = resolveDocumentPath(filePath);
      assertWithinRoots(targetPath, [kitRoot], 'save asset');

      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, content, 'utf-8');

      res.json({ success: true, targetPath, message: '자원 내용이 성공적으로 저장되었습니다.' });
    } catch (err) {
      console.error('Error in save-asset-content:', err);
      sendServerError(res, err);
    }
  });

  return router;
}
