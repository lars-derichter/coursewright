const { get, post, put, del } = require('./client');

/**
 * List all modules in a course.
 */
function listModules(courseId) {
  return get(`/api/v1/courses/${courseId}/modules`);
}

/**
 * Create a new module.
 *
 * @param {string|number} courseId
 * @param {object} opts
 * @param {string} opts.name
 * @param {number} [opts.position]
 */
function createModule(courseId, { name, position } = {}) {
  const module = { name };
  if (position !== undefined) module.position = position;
  return post(`/api/v1/courses/${courseId}/modules`, { module });
}

/**
 * Update an existing module.
 *
 * @param {string|number} courseId
 * @param {string|number} moduleId
 * @param {object} opts
 * @param {string} [opts.name]
 * @param {number} [opts.position]
 */
function updateModule(courseId, moduleId, { name, position } = {}) {
  const module = {};
  if (name !== undefined) module.name = name;
  if (position !== undefined) module.position = position;
  return put(`/api/v1/courses/${courseId}/modules/${moduleId}`, { module });
}

/**
 * Delete a module.
 */
function deleteModule(courseId, moduleId) {
  return del(`/api/v1/courses/${courseId}/modules/${moduleId}`);
}

/**
 * List all items in a module.
 */
function listModuleItems(courseId, moduleId) {
  return get(`/api/v1/courses/${courseId}/modules/${moduleId}/items`);
}

/**
 * Read one module item as Canvas holds it now.
 *
 * The gather reads every item through `listModuleItems`, and that is what the
 * planner decides from. This is for the executor, which sometimes has to know
 * what an item looks like after the run's earlier writes, or after Canvas acted
 * on one of them by itself: replacing a file repoints the module item that
 * named it, and nothing in the upload's answer says so.
 *
 * @param {string|number} courseId
 * @param {string|number} moduleId
 * @param {string|number} itemId
 */
function getModuleItem(courseId, moduleId, itemId) {
  return get(`/api/v1/courses/${courseId}/modules/${moduleId}/items/${itemId}`);
}

/**
 * Create a new item inside a module.
 *
 * @param {string|number} courseId
 * @param {string|number} moduleId
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.type - One of: File, Page, Discussion, Assignment, Quiz,
 *                              SubHeader, ExternalUrl, ExternalTool
 * @param {string|number} [opts.contentId] - The id of the content item (assignment id, file id, etc.)
 * @param {string} [opts.pageUrl] - The URL slug of the wiki page (required for type 'Page')
 * @param {number} [opts.position]
 * @param {number} [opts.indent] - 0-5
 * @param {string} [opts.externalUrl]
 * @param {boolean} [opts.newTab]
 */
function createModuleItem(
  courseId,
  moduleId,
  {
    title,
    type,
    contentId,
    pageUrl,
    position,
    indent,
    externalUrl,
    newTab,
  } = {},
) {
  const module_item = { title, type };
  if (pageUrl !== undefined) module_item.page_url = pageUrl;
  if (contentId !== undefined) module_item.content_id = contentId;
  if (position !== undefined) module_item.position = position;
  if (indent !== undefined) module_item.indent = indent;
  if (externalUrl !== undefined) module_item.external_url = externalUrl;
  if (newTab !== undefined) module_item.new_tab = newTab;
  return post(`/api/v1/courses/${courseId}/modules/${moduleId}/items`, {
    module_item,
  });
}

/**
 * Update an existing module item.
 *
 * `updates.moduleId` moves the item into another module, which Canvas takes on
 * this same endpoint. That is the only way to move one without losing its id,
 * and the id is what a `/modules/items/:id` link handed to a student points at
 * — so a move is an update here and never a delete followed by a create.
 *
 * @param {string|number} courseId
 * @param {string|number} moduleId - The module the item is in *now*.
 * @param {string|number} itemId
 * @param {object} updates - Fields to update (title, position, indent,
 *   externalUrl, newTab, published, moduleId).
 */
function updateModuleItem(courseId, moduleId, itemId, updates = {}) {
  const module_item = {};
  if (updates.moduleId !== undefined) module_item.module_id = updates.moduleId;
  if (updates.title !== undefined) module_item.title = updates.title;
  if (updates.position !== undefined) module_item.position = updates.position;
  if (updates.indent !== undefined) module_item.indent = updates.indent;
  if (updates.externalUrl !== undefined)
    module_item.external_url = updates.externalUrl;
  if (updates.newTab !== undefined) module_item.new_tab = updates.newTab;
  if (updates.published !== undefined)
    module_item.published = updates.published;
  return put(
    `/api/v1/courses/${courseId}/modules/${moduleId}/items/${itemId}`,
    { module_item },
  );
}

/**
 * Delete a module item.
 */
function deleteModuleItem(courseId, moduleId, itemId) {
  return del(`/api/v1/courses/${courseId}/modules/${moduleId}/items/${itemId}`);
}

module.exports = {
  listModules,
  createModule,
  updateModule,
  deleteModule,
  listModuleItems,
  getModuleItem,
  createModuleItem,
  updateModuleItem,
  deleteModuleItem,
};
