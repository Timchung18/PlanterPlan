import React, { createContext, useState, useContext, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from './AuthContext';
import { useOrganization } from './OrganizationProvider';
import { useLicenses } from '../../hooks/useLicenses'; // Import the new license hook
import { useLocation } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { getNextAvailablePosition, generateSparsePositions } from '../../utils/sparsePositioning';

// Import functions from taskService directly if you're not using useTaskService
import { 
  fetchAllTasks, 
  createTask, 
  updateTaskPosition, 
  updateSiblingPositions, 
  updateTaskCompletion,
  deleteTask,
  updateTaskDateFields,
  updateTaskComplete, 
} from '../../services/taskService';

// Import the date utility functions
import { 
  calculateDueDate,
  calculateStartDate,
  updateDependentTaskDates,
  determineTaskStartDate,
  calculateSequentialDatesForHierarchy,
  calculateTaskEndDate,
  updateTaskDatesInHierarchy
} from '../../utils/dateUtils';

// Replace the existing imports
import { 
  calculateParentDuration, 
  calculateSequentialStartDates,
  updateAncestorDurations,
  updateAfterReordering,
  getTasksRequiringUpdates,
  updateTasksInDatabase
} from '../../utils/sequentialTaskManager';

// Create a context for tasks
const TaskContext = createContext();

// Custom hook to use the task context
export const useTasks = () => {
  const context = useContext(TaskContext);
  if (context === undefined) {
    throw new Error('useTasks must be used within a TaskProvider');
  }
  return context;
};

// Provider component that wraps your app
export const TaskProvider = ({ children }) => {
  const { user, loading: userLoading } = useAuth();
  const { organization, organizationId, loading: orgLoading } = useOrganization();
  const location = useLocation();

  // Use the license hook
  const {
    canCreateProject,
    userHasProjects,
    projectLimitReason,
    userLicenses,
    selectedLicenseId,
    isCheckingLicense,
    validateProjectCreation,
    // We can still expose the license functions through the task context if needed
    ...licenseActions
  } = useLicenses();
  
  // State for tasks - ONLY the main tasks array
  const [tasks, setTasks] = useState([]);

  const [loading, setLoading] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isFetching, setIsFetching] = useState(false);
  const isMountedRef = useRef(true);
  
  
  // Refs for tracking state without triggering re-renders
  const initialFetchDoneRef = useRef(false);
  
  // Derived task arrays using useMemo for performance
  const instanceTasks = useMemo(() => 
    tasks.filter(task => task.origin === "instance"), 
    [tasks]
  );
  
  const templateTasks = useMemo(() => 
    tasks.filter(task => task.origin === "template"), 
    [tasks]
  );

  // Update tasks state safely - simplified without enhanced calculations
  const updateTasks = useCallback((newTasks, isOptimistic = false) => {
    if (!Array.isArray(newTasks)) {
      console.error('updateTasks received non-array value:', newTasks);
      return;
    }
    
    try {
      if (isOptimistic) {
        console.log('🔄 Updating tasks optimistically...');
      }
      
      // Update main tasks array
      setTasks(newTasks);
      
      if (isOptimistic) {
        console.log('✅ Tasks updated optimistically');
      }
    } catch (err) {
      console.error('Error in updateTasks:', err);
    }
  }, []);
  
  // Fetch all tasks (both instances and templates)
  const fetchTasks = useCallback(async (forceRefresh = false) => {
    // Skip if already fetching or missing required IDs
    if (isFetching && !forceRefresh) {
      console.log('Already fetching tasks, skipping this request');
      return { instanceTasks, templateTasks };
    }
    
    if (!user?.id) {
      console.warn('Missing user ID, skipping fetch');
      return { instanceTasks, templateTasks };
    }
    
    try {
      setIsFetching(true);
      setLoading(true);
      
      console.log('Fetching tasks with params:', { organizationId, userId: user.id });
      
      // Fetch instance tasks - filter by user AND organization
      const instanceResult = await fetchAllTasks(organizationId, user.id, 'instance');
      
      // Fetch template tasks - filter by organization only (not by user)
      const templateResult = await fetchAllTasks(organizationId, null, 'template');
      
      const instanceData = instanceResult.data || [];
      const templateData = templateResult.data || [];
      
      if (instanceResult.error) {
        console.error('Error fetching instance tasks:', instanceResult.error);
      }
      
      if (templateResult.error) {
        console.error('Error fetching template tasks:', templateResult.error);
      }
      
      // If both requests failed, throw an error
      if (instanceResult.error && templateResult.error) {
        throw new Error(`Failed to fetch tasks: ${instanceResult.error}`);
      }
      
      console.log('Fetch complete:', {
        instanceCount: instanceData.length,
        templateCount: templateData.length
      });
      
      // Combine all tasks and update state
      const allTasks = [...instanceData, ...templateData];
      setTasks(allTasks);
      setError(null);
      
      // Mark initial fetch as complete
      initialFetchDoneRef.current = true;
      
      // Return filtered arrays for backward compatibility
      return { instanceTasks: instanceData, templateTasks: templateData };
    } catch (err) {
      console.error('Error fetching tasks:', err);
      setError(`Failed to load tasks: ${err.message}`);
      return { error: err.message, instanceTasks, templateTasks };
    } finally {
      setLoading(false);
      setIsFetching(false);
      setInitialLoading(false);
    }
  }, [organizationId, user?.id, instanceTasks, templateTasks]);
  
const createNewTask = useCallback(async (taskData, licenseId = null) => {
  try {
    console.log('Creating task with data:', taskData);
    console.log('License key', licenseId);
    
    if (!user?.id) {
      throw new Error('Cannot create task: User ID is missing');
    }
    
    // Check if this is a top-level project creation
    const isTopLevelProject = !taskData.parent_task_id && taskData.origin === "instance";
    
    // For top-level projects, check if the user already has projects
    if (isTopLevelProject) {
      const validation = validateProjectCreation(licenseId);
      if (!validation.canCreate) {
        throw new Error(validation.reason);
      }
      // Use the validated license ID
      licenseId = validation.licenseId;
    }
    
    // Handle sparse positioning if not already set
    let enhancedTaskData = {
      ...taskData,
      creator: user.id,
      origin: taskData.origin || "instance",
      white_label_id: organizationId,
      license_id: licenseId
    };
    
    // Calculate sparse position if not explicitly provided
    if (enhancedTaskData.position === undefined) {
      enhancedTaskData.position = getNextAvailablePosition(tasks, taskData.parent_task_id);
      console.log('Calculated sparse position:', enhancedTaskData.position, 'for parent:', taskData.parent_task_id);
    }
    
    // *** CONSOLIDATED DATE CALCULATIONS - delegate to dateUtils ***
    // Determine the start date based on position using dateUtils
    if (taskData.parent_task_id) {
      const calculatedStartDate = determineTaskStartDate({
        ...enhancedTaskData,
      }, tasks);
      
      if (calculatedStartDate) {
        enhancedTaskData.start_date = calculatedStartDate.toISOString();
        
        // Calculate due date using dateUtils
        if (taskData.duration_days) {
          const calculatedDueDate = calculateDueDate(
            calculatedStartDate,
            taskData.duration_days
          );
          
          if (calculatedDueDate) {
            enhancedTaskData.due_date = calculatedDueDate.toISOString();
          }
        }
      } else if (taskData.days_from_start_until_due !== undefined) {
        // Fall back to dateUtils calculation method
        const parentTask = tasks.find(t => t.id === taskData.parent_task_id);
        
        if (parentTask && parentTask.start_date) {
          const fallbackDate = calculateStartDate(
            parentTask.start_date,
            taskData.days_from_start_until_due
          );
          
          if (fallbackDate) {
            enhancedTaskData.start_date = fallbackDate.toISOString();
            
            if (taskData.duration_days) {
              const calculatedDueDate = calculateDueDate(
                fallbackDate,
                taskData.duration_days
              );
              
              if (calculatedDueDate) {
                enhancedTaskData.due_date = calculatedDueDate.toISOString();
              }
            }
          }
        }
      }
    } 
    // For tasks with start_date and duration_days but no due_date - use dateUtils
    else if (taskData.start_date && taskData.duration_days && !taskData.due_date) {
      const calculatedDueDate = calculateDueDate(
        taskData.start_date,
        taskData.duration_days
      );
      
      if (calculatedDueDate) {
        enhancedTaskData.due_date = calculatedDueDate.toISOString();
      }
    }
    // For top-level projects without a start date, set to current date and calculate due date
    else if (isTopLevelProject && !enhancedTaskData.start_date) {
      const currentDate = new Date();
      enhancedTaskData.start_date = currentDate.toISOString();
      
      if (enhancedTaskData.duration_days) {
        const calculatedDueDate = calculateDueDate(
          currentDate,
          enhancedTaskData.duration_days
        );
        
        if (calculatedDueDate) {
          enhancedTaskData.due_date = calculatedDueDate.toISOString();
        }
      }
    }
    
    console.log('Enhanced task data with sparse positioning:', enhancedTaskData);
    
    // Use the createTask function
    const result = await createTask(enhancedTaskData);
    
    if (result.error) {
      console.error('Error from createTask API:', result.error);
      throw new Error(result.error);
    }
    
    console.log('Task created successfully:', result.data);
    
    if (result.data) {
      // Update the combined tasks list
      setTasks(prev => [...prev, result.data]);
      
      // Update dates for child tasks if any dates changed in the parent - delegate to dateUtils
      if (taskData.parent_task_id) {
        const updatedTasks = updateDependentTaskDates(
          taskData.parent_task_id,
          [...tasks, result.data]
        );
        
        // Update all task arrays with the recalculated dates
        updateTasks(updatedTasks);
        
        // Update affected tasks in database
        for (const updatedTask of updatedTasks) {
          // Skip the newly created task (already saved with correct dates)
          if (updatedTask.id === result.data.id) continue;
          
          // Only update tasks with changed dates
          const originalTask = tasks.find(t => t.id === updatedTask.id);
          if (originalTask && (
            originalTask.start_date !== updatedTask.start_date ||
            originalTask.due_date !== updatedTask.due_date
          )) {
            await updateTaskDateFields(updatedTask.id, {
              start_date: updatedTask.start_date,
              due_date: updatedTask.due_date
            });
          }
        }
      }
      
    }
    
    return { data: result.data, error: null };
  } catch (err) {
    console.error('Error creating task:', err);
    return { data: null, error: err.message };
  }
}, [user?.id, organizationId, validateProjectCreation, tasks, updateTasks]);
  
/**
 * Updates a task including recalculating durations for templates
 */
const updateTaskHandler = async (taskId, updatedTaskData) => {
  try {
    // Find the original task
    const originalTask = tasks.find(t => t.id === taskId);
    if (!originalTask) {
      throw new Error('Task not found');
    }
    
    // Check if default_duration was changed
    const defaultDurationChanged = 
      updatedTaskData.default_duration !== undefined && 
      updatedTaskData.default_duration !== originalTask.default_duration;
    
    // If this is a template with default_duration changes, handle ancestor impacts
    if (originalTask.origin === 'template' && defaultDurationChanged && 
        updatedTaskData.affectedAncestors && updatedTaskData.affectedAncestors.length > 0) {
      
      console.log('Handling ancestor impacts:', updatedTaskData.affectedAncestors);
      
      // Prepare updates for affected ancestors
      const ancestorUpdates = updatedTaskData.affectedAncestors.map(ancestor => ({
        id: ancestor.id,
        duration_days: ancestor.newDuration
        // Note: We don't update default_duration, which stays as what the user set
      }));
      
      // Make a copy of the updatedTaskData without the affectedAncestors property
      const taskUpdateData = { ...updatedTaskData };
      delete taskUpdateData.affectedAncestors;
      
      // First perform the regular update
      const result = await updateTaskComplete(taskId, taskUpdateData);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to update task');
      }
      
      // Then update all the ancestors
      for (const update of ancestorUpdates) {
        await updateTaskComplete(update.id, { duration_days: update.duration_days });
      }
      
      // Refresh tasks to get the latest state
      await fetchTasks(true);
      
      return { success: true, data: result.data };
    }
    
    // Standard update flow for other cases
    const result = await updateTaskComplete(taskId, updatedTaskData);
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to update task');
    }
    
    // Update all tasks with the new data
    let updatedTaskList = tasks.map(task => 
      task.id === taskId ? { ...task, ...result.data } : task
    );
    
    // If this is a template task, check if we need to update child durations
    if (originalTask.origin === 'template') {
      // Check if the task has children
      const hasChildren = updatedTaskList.some(t => t.parent_task_id === taskId);
      
      if (hasChildren) {
        // Recalculate durations for this task and its descendants
        updatedTaskList = updateAncestorDurations(taskId, updatedTaskList);
        
        // Update tasks in database that need updating
        const tasksToUpdate = getTasksRequiringUpdates(tasks, updatedTaskList);
        await updateTasksInDatabase(tasksToUpdate, updateTaskComplete);
      }
      
      // If this task has a parent, update ancestor durations
      if (originalTask.parent_task_id && defaultDurationChanged) {
        updatedTaskList = updateAncestorDurations(originalTask.id, updatedTaskList);
        
        // Update tasks in database that need updating
        const tasksToUpdate = getTasksRequiringUpdates(tasks, updatedTaskList);
        await updateTasksInDatabase(tasksToUpdate, updateTaskComplete);
      }
    }
    
    // Update the state with our modified list
    updateTasks(updatedTaskList);
    
    return { success: true, data: result.data };
  } catch (err) {
    console.error('Error updating task:', err);
    return { success: false, error: err.message };
  }
};

// Update a task's date fields - delegate calculations to dateUtils
const updateTaskDates = useCallback(async (taskId, dateData) => {
  try {
    console.log('Updating task dates:', taskId, dateData);
    
    // Find the task to update
    const taskToUpdate = tasks.find(t => t.id === taskId);
    if (!taskToUpdate) {
      throw new Error('Task not found');
    }
    
    // *** CONSOLIDATED DATE CALCULATIONS - delegate to dateUtils ***
    let enhancedDateData = { ...dateData };
    
    // Calculate due date using dateUtils if needed
    if (dateData.start_date && dateData.duration_days && !dateData.due_date) {
      const calculatedDueDate = calculateDueDate(
        dateData.start_date,
        dateData.duration_days
      );
      
      if (calculatedDueDate) {
        enhancedDateData.due_date = calculatedDueDate.toISOString();
      }
    }
    
    // Update the task in the database
    const result = await updateTaskDateFields(taskId, enhancedDateData);
    
    if (result.error) {
      throw new Error(result.error);
    }
    
    // Update the task in local state
    const updatedTask = { ...taskToUpdate, ...enhancedDateData };
    
    // Create updated task lists
    const updatedTasks = tasks.map(t => t.id === taskId ? updatedTask : t);
    
    // If this task has children, we need to update their dates too - delegate to dateUtils
    const hasChildren = tasks.some(t => t.parent_task_id === taskId);
    
    if (hasChildren) {
      // Recalculate dates for all child tasks using dateUtils
      const tasksWithUpdatedDates = updateDependentTaskDates(taskId, updatedTasks);
      
      // Update all tasks in the state
      updateTasks(tasksWithUpdatedDates);
      
      // Update child tasks in database
      const childTasks = tasksWithUpdatedDates.filter(t => t.parent_task_id === taskId);
      
      for (const childTask of childTasks) {
        const originalChild = tasks.find(t => t.id === childTask.id);
        
        // Only update if dates actually changed
        if (originalChild && (
          originalChild.start_date !== childTask.start_date ||
          originalChild.due_date !== childTask.due_date
        )) {
          await updateTaskDateFields(childTask.id, {
            start_date: childTask.start_date,
            due_date: childTask.due_date
          });
        }
      }
    } else {
      // No children, just update this task
      updateTasks(updatedTasks);
    }
    
    return { success: true, data: updatedTask };
  } catch (err) {
    console.error('Error updating task dates:', err);
    return { success: false, error: err.message };
  }
}, [tasks, updateTasks]);






/**
 * Get all tasks in a hierarchy (parent and all descendants)
 * @param {string} rootId - Root task ID
 * @param {Array} allTasks - All tasks array
 * @returns {Array} - Array containing the root task and all its descendants
 */
const getAllTasksInHierarchy = (rootId, allTasks) => {
  if (!rootId || !Array.isArray(allTasks) || allTasks.length === 0) {
    return [];
  }
  
  const result = [];
  
  // Helper function to recursively collect tasks
  const collectTasks = (parentId) => {
    const parent = allTasks.find(t => t.id === parentId);
    if (parent) result.push(parent);
    
    const children = allTasks.filter(t => t.parent_task_id === parentId);
    result.push(...children);
    
    // Process each child's children
    children.forEach(child => collectTasks(child.id));
  };
  
  // Start collection from the root
  collectTasks(rootId);
  
  return result;
};

  /**
  * Deletes a task and all its children with duration updates
  */
  const deleteTaskHandler = useCallback(async (taskId, deleteChildren = true) => {
    try {
      // Find the task
      const taskToDelete = tasks.find(t => t.id === taskId);
      if (!taskToDelete) {
        throw new Error('Task not found');
      }
      
      console.log(`Deleting task ${taskId} (with children: ${deleteChildren})`);
      
      // Store parent ID to update dates for siblings later
      const parentId = taskToDelete.parent_task_id;
      const isTemplate = taskToDelete.origin === 'template';
      
      // Use the deleteTask function
      const result = await deleteTask(taskId, deleteChildren);
      
      if (!result.success) {
        // Error handling for date issues (keep your existing code)
        if (result.error && (
          result.error.includes("Invalid time value") || 
          result.error.includes("Invalid date")
        )) {
          console.warn("Date calculation issue during deletion, continuing with UI update");
          
          // Get IDs of children to be removed (keep your existing code)
          const childTaskIds = [];
          const findAllChildren = (parentId) => {
            const children = tasks.filter(t => t.parent_task_id === parentId).map(t => t.id);
            childTaskIds.push(...children);
            children.forEach(childId => findAllChildren(childId));
          };
          
          let allTaskIdsToDelete = [taskId];
          if (deleteChildren) {
            findAllChildren(taskId);
            allTaskIdsToDelete = [...allTaskIdsToDelete, ...childTaskIds];
          }
          
          // Create updatedTasks without the deleted ones
          const updatedTaskList = tasks.filter(task => !allTaskIdsToDelete.includes(task.id));
          
          // If this was a template with a parent, update the parent's duration
          if (isTemplate && parentId) {
            // Update parent and reorder siblings
            const reorderedTasks = updateAfterReordering(parentId, updatedTaskList);
            
            // If parent has duration changes, update ancestors
            const parent = reorderedTasks.find(t => t.id === parentId);
            if (parent) {
              const newDuration = calculateParentDuration(parentId, reorderedTasks);
              if (parent.duration_days !== newDuration) {
                const tasksWithUpdatedDurations = updateAncestorDurations(parentId, reorderedTasks);
                
                // Get tasks that need database updates
                const tasksToUpdate = getTasksRequiringUpdates(updatedTaskList, tasksWithUpdatedDurations);
                await updateTasksInDatabase(tasksToUpdate, updateTaskComplete);
                
                // Update state
                updateTasks(tasksWithUpdatedDurations);
                return { 
                  success: true, 
                  deletedIds: allTaskIdsToDelete,
                  hasChildren: childTaskIds.length > 0
                };
              }
            }
            
            // Update state with just reordered tasks
            updateTasks(reorderedTasks);
          } else {
            // Just update without the deleted tasks
            updateTasks(updatedTaskList);
          }
          
          return { 
            success: true, 
            deletedIds: allTaskIdsToDelete,
            hasChildren: childTaskIds.length > 0
          };
        }
        
        throw new Error(result.error);
      }
      
      // Remove all deleted tasks from local state
      if (result.deletedIds && Array.isArray(result.deletedIds)) {
        // Create updated tasks without the deleted ones
        const updatedTaskList = tasks.filter(task => !result.deletedIds.includes(task.id));
        
        console.log(`Deleted ${result.deletedIds.length} tasks`);
        
        // If this was a template with a parent, update the parent's duration
        if (isTemplate && parentId) {
          // Update parent with new duration and reorder siblings
          const reorderedTasks = updateAfterReordering(parentId, updatedTaskList);
          
          // Check if parent duration changed
          const parent = reorderedTasks.find(t => t.id === parentId);
          if (parent) {
            const newDuration = calculateParentDuration(parentId, reorderedTasks);
            if (parent.duration_days !== newDuration) {
              // Calculate all duration and date updates
              const withUpdatedDurations = updateAncestorDurations(parentId, reorderedTasks);
              
              // Update database with changes
              const tasksToUpdate = getTasksRequiringUpdates(updatedTaskList, withUpdatedDurations);
              await updateTasksInDatabase(tasksToUpdate, updateTaskComplete);
              
              // Update state
              updateTasks(withUpdatedDurations);
              return { 
                success: true, 
                deletedIds: result.deletedIds,
                hasChildren: result.deletedIds.length > 1
              };
            }
          }
          
          // Update state with just reordered tasks
          updateTasks(reorderedTasks);
        } else {
          // Update all task arrays without updating durations
          updateTasks(updatedTaskList);
        }
      }
      
      return { 
        success: true, 
        deletedIds: result.deletedIds,
        hasChildren: result.deletedIds && result.deletedIds.length > 1
      };
    } catch (err) {
      console.error('Error deleting task:', err);
      
      // Return a more specific error for dates
      if (err.message && (
        err.message.includes("Invalid time value") || 
        err.message.includes("Invalid date")
      )) {
        return { 
          success: false, 
          error: "Date calculation error during deletion. Try refreshing the page." 
        };
      }
      
      return { success: false, error: err.message };
    }
  }, [tasks, deleteTask, updateTaskComplete, updateTasks]);
  
  

  // Simplified createProjectFromTemplate function
// Replace the existing function in TaskContext.js

/**
 * Create a new project from a template with proper date scheduling
 * @param {string} templateId - ID of the template to use
 * @param {Object} projectData - Basic project data including start date
 * @param {string} licenseId - Optional license ID for the project
 * @returns {Promise<{data: Object, error: string}>} - Created project or error
 */
const createProjectFromTemplate = async (templateId, projectData, licenseId = null) => {
  try {
    console.log('Creating project from template:', templateId);
    
    if (!user?.id) {
      throw new Error('Cannot create project: User ID is missing');
    }
    
    if (!templateId) {
      throw new Error('Template ID is required');
    }
    
    // Find the template to clone
    const template = templateTasks.find(t => t.id === templateId);
    if (!template) {
      throw new Error(`Template with ID ${templateId} not found`);
    }
    
    // Calculate the effective duration for the template
    const effectiveDuration = template.duration_days || template.default_duration || 1;
    
    // *** CONSOLIDATED DATE CALCULATIONS - delegate to dateUtils ***
    // Set the project start date (from user input or default to today)
    const projectStartDate = projectData.startDate ? new Date(projectData.startDate) : new Date();
    
    // Prepare the initial project data
    const projectBaseData = {
      title: projectData.name || template.title,
      description: template.description,
      purpose: template.purpose,
      actions: template.actions || [],
      resources: template.resources || [],
      origin: 'instance',
      is_complete: false,
      creator: user.id,
      white_label_id: organizationId,
      license_id: licenseId,
      start_date: projectStartDate.toISOString(),
      parent_task_id: null, // Top-level project
      position: getNextAvailablePosition(instanceTasks, null),
      default_duration: template.default_duration || 1,
      duration_days: effectiveDuration
    };
    
    // Calculate the project due date using dateUtils
    const calculatedDueDate = calculateDueDate(
      projectStartDate,
      effectiveDuration
    );
    
    if (calculatedDueDate) {
      projectBaseData.due_date = calculatedDueDate.toISOString();
    }
    
    // Create the top-level project
    const result = await createTask(projectBaseData);
    
    if (result.error) {
      throw new Error(result.error);
    }
    
    // Store the created project
    const newProject = result.data;
    console.log('Created root project:', newProject);
    
    // Track created tasks for date calculation later
    const createdTasksArray = [newProject];
    
    // Map to track template ID to corresponding project task ID
    const templateToProjectMap = {
      [templateId]: newProject.id
    };
    
    // Get all template tasks in the hierarchy
    const templateTasksTree = await getAllTemplateTasksInHierarchy(templateId);
    console.log(`Found ${templateTasksTree.length} template tasks in hierarchy`);
    
    // Create all child tasks first - process by level to ensure parents exist before children
    // Sort template tasks by their level in the hierarchy
    const templateTasksByLevel = {};
    templateTasksTree.forEach(task => {
      // Calculate level
      let level = 0;
      let currentTask = task;
      while (currentTask.parent_task_id) {
        level++;
        currentTask = templateTasksTree.find(t => t.id === currentTask.parent_task_id) || {};
      }
      
      if (!templateTasksByLevel[level]) {
        templateTasksByLevel[level] = [];
      }
      templateTasksByLevel[level].push(task);
    });
    
    // Process each level in order (except level 0 which is the root)
    const levels = Object.keys(templateTasksByLevel).sort((a, b) => parseInt(a) - parseInt(b));
    
    for (const level of levels) {
      if (level === '0') continue; // Skip the root level
      
      const tasksAtLevel = templateTasksByLevel[level];
      console.log(`Processing ${tasksAtLevel.length} tasks at level ${level}`);
      
      for (const templateTask of tasksAtLevel) {
        // Find the parent's ID in our new project
        const templateParentId = templateTask.parent_task_id;
        const projectParentId = templateToProjectMap[templateParentId];
        
        if (!projectParentId) {
          console.error(`Missing project parent ID for template: ${templateTask.title}`);
          continue; // Skip this task if parent mapping is missing
        }
        
        // Create the child task with basic properties
        const childTaskData = {
          title: templateTask.title,
          description: templateTask.description,
          purpose: templateTask.purpose,
          actions: templateTask.actions || [],
          resources: templateTask.resources || [],
          origin: 'instance',
          is_complete: false,
          creator: user.id,
          white_label_id: organizationId,
          parent_task_id: projectParentId,
          position: templateTask.position || getNextAvailablePosition(
            createdTasksArray.filter(t => t.parent_task_id === projectParentId),
            projectParentId
          ),
          default_duration: templateTask.default_duration || 1,
          duration_days: templateTask.duration_days || 1,
        };
        
        // Create the task
        const childResult = await createTask(childTaskData);
        
        if (childResult.error) {
          console.error('Error creating child task:', childResult.error);
          continue; // Continue with other tasks even if this one fails
        }
        
        // Add to created tasks array
        createdTasksArray.push(childResult.data);
        
        // Store the mapping for future children
        templateToProjectMap[templateTask.id] = childResult.data.id;
      }
    }
    
    console.log(`Created ${createdTasksArray.length} tasks total`);
    
    // *** CONSOLIDATED DATE CALCULATIONS - delegate to dateUtils ***
    // Use calculateSequentialStartDates from dateUtils to set all dates correctly
    const tasksWithCalculatedDates = calculateSequentialStartDates(
      newProject.id,
      projectStartDate,
      createdTasksArray
    );
    
    console.log('Calculated dates for all tasks using dateUtils');
    
    // Update all tasks with their calculated dates
    const updatePromises = [];
    
    for (const task of tasksWithCalculatedDates) {
      // Skip the root project if it already has correct dates
      if (task.id === newProject.id && 
          task.start_date === newProject.start_date && 
          task.due_date === newProject.due_date) {
        continue;
      }
      
      // Find the original task
      const originalTask = createdTasksArray.find(t => t.id === task.id);
      if (!originalTask) continue;
      
      // Only update if dates changed
      if (originalTask.start_date !== task.start_date || 
          originalTask.due_date !== task.due_date ||
          originalTask.duration_days !== task.duration_days) {
        
        // Log for debugging
        console.log(`Updating task ${task.id} (${task.title || 'unnamed'}):`);
        console.log(` - Start: ${originalTask.start_date} → ${task.start_date}`);
        console.log(` - Due: ${originalTask.due_date} → ${task.due_date}`);
        console.log(` - Duration: ${originalTask.duration_days} → ${task.duration_days}`);
        
        updatePromises.push(
          updateTaskDateFields(task.id, {
            start_date: task.start_date,
            due_date: task.due_date,
            duration_days: task.duration_days
          })
        );
      }
    }
    
    // Wait for all updates to complete
    if (updatePromises.length > 0) {
      console.log(`Updating dates for ${updatePromises.length} tasks`);
      await Promise.all(updatePromises);
    }
    
    // Refresh tasks to get the latest state
    await fetchTasks(true);
    
    return { data: newProject, error: null };
  } catch (err) {
    console.error('Error creating project from template:', err);
    return { data: null, error: err.message };
  }
};

/**
 * Helper function to get all template tasks in a hierarchy
 * @param {string} rootTemplateId - The root template ID
 * @returns {Promise<Array>} - All template tasks in the hierarchy
 */
const getAllTemplateTasksInHierarchy = async (rootTemplateId) => {
  // First, try to use the in-memory template tasks
  let templates = templateTasks;
  
  // If that's empty, fetch from the database
  if (!templates || templates.length === 0) {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('origin', 'template');
      
    if (error) throw new Error(error.message);
    templates = data || [];
  }
  
  // Get all templates in the hierarchy
  const result = [];
  
  // Helper function to recursively collect templates
  const collectTemplates = (parentId) => {
    const children = templates.filter(t => t.parent_task_id === parentId);
    result.push(...children);
    
    // Recursively process each child's children
    children.forEach(child => collectTemplates(child.id));
  };
  
  // Start with the root template
  const rootTemplate = templates.find(t => t.id === rootTemplateId);
  if (rootTemplate) {
    result.push(rootTemplate);
    collectTemplates(rootTemplateId);
  }
  
  return result;
};


/**
 * Calculate sequential dates for all tasks
 * @param {Array} tasks - Array of tasks to calculate dates for
 */
const calculateSequentialDates = (tasks) => {
  // Sort tasks by hierarchy level to ensure parents are processed before children
  const tasksByLevel = {};
  tasks.forEach(task => {
    const level = task._hierarchyLevel;
    if (!tasksByLevel[level]) tasksByLevel[level] = [];
    tasksByLevel[level].push(task);
  });
  
  // Process each level in order
  const levels = Object.keys(tasksByLevel).sort((a, b) => parseInt(a) - parseInt(b));
  
  for (const level of levels) {
    const tasksAtLevel = tasksByLevel[level];
    
    // Group by parent
    const tasksByParent = {};
    tasksAtLevel.forEach(task => {
      const parentKey = task.parent_task_id || 'root';
      if (!tasksByParent[parentKey]) tasksByParent[parentKey] = [];
      tasksByParent[parentKey].push(task);
    });
    
    // Process each parent group
    for (const [parentKey, siblings] of Object.entries(tasksByParent)) {
      // Sort siblings by position
      siblings.sort((a, b) => (a.position || 0) - (b.position || 0));
      
      // Get parent's start date
      let parentStartDate;
      if (parentKey === 'root') {
        // Root level - use project start date from first task
        parentStartDate = new Date(); // This will be set properly below
      } else {
        const parent = tasks.find(t => t.id === parentKey);
        parentStartDate = parent ? new Date(parent.start_date) : new Date();
      }
      
      // Calculate sequential dates for siblings
      let currentDate = new Date(parentStartDate);
      
      for (let i = 0; i < siblings.length; i++) {
        const task = siblings[i];
        
        // Set start date
        task.start_date = new Date(currentDate).toISOString();
        
        // Calculate due date
        const dueDate = new Date(currentDate);
        dueDate.setDate(dueDate.getDate() + task.duration_days);
        task.due_date = dueDate.toISOString();
        
        // Next sibling starts when this one ends
        currentDate = new Date(dueDate);
      }
      
      // Update parent's due date to match last child's due date
      if (parentKey !== 'root' && siblings.length > 0) {
        const parent = tasks.find(t => t.id === parentKey);
        const lastChild = siblings[siblings.length - 1];
        if (parent && lastChild) {
          parent.due_date = lastChild.due_date;
        }
      }
    }
  }
  
  // Set root project start date properly
  const rootTask = tasks.find(t => !t.parent_task_id);
  if (rootTask && !rootTask.start_date) {
    const projectStartDate = new Date(); // Should come from projectData
    rootTask.start_date = projectStartDate.toISOString();
    
    // Recalculate if root has children
    const rootChildren = tasks.filter(t => t.parent_task_id === rootTask.id);
    if (rootChildren.length > 0) {
      // Root's due date should match last child's due date
      const lastChild = rootChildren.sort((a, b) => (a.position || 0) - (b.position || 0)).pop();
      rootTask.due_date = lastChild.due_date;
    } else {
      // Root has no children, calculate its own due date
      const dueDate = new Date(projectStartDate);
      dueDate.setDate(dueDate.getDate() + rootTask.duration_days);
      rootTask.due_date = dueDate.toISOString();
    }
  }
};

/**
 * Batch create all tasks in Supabase
 * @param {Array} tasks - Array of tasks to create
 * @returns {Array} - Array of created tasks with real IDs
 */
const batchCreateTasks = async (tasks) => {
  const createdTasks = [];
  const tempToRealIdMap = new Map();
  
  // Sort by hierarchy level to create parents before children
  const sortedTasks = [...tasks].sort((a, b) => a._hierarchyLevel - b._hierarchyLevel);
  
  for (const task of sortedTasks) {
    // Replace temporary parent ID with real ID
    let realParentId = null;
    if (task.parent_task_id) {
      realParentId = tempToRealIdMap.get(task.parent_task_id);
      if (!realParentId) {
        console.error('Parent ID not found in mapping:', task.parent_task_id);
        continue;
      }
    }
    
    // Prepare task data for database (remove temporary fields)
    const taskData = {
      title: task.title,
      description: task.description,
      purpose: task.purpose,
      actions: task.actions,
      resources: task.resources,
      origin: task.origin,
      is_complete: task.is_complete,
      creator: task.creator,
      white_label_id: task.white_label_id,
      license_id: task.license_id,
      parent_task_id: realParentId,
      position: task.position,
      default_duration: task.default_duration,
      duration_days: task.duration_days,
      start_date: task.start_date,
      due_date: task.due_date
    };
    
    // Create task in database
    const result = await createTask(taskData);
    if (result.error) {
      console.error('Error creating task:', result.error);
      throw new Error(`Failed to create task: ${task.title}`);
    }
    
    // Store mapping and created task
    tempToRealIdMap.set(task.id, result.data.id);
    createdTasks.push(result.data);
  }
  
  return createdTasks;
};

/**
 * Update task positions and dates after drag and drop rearrangement
 * @param {string} taskId - ID of the dragged task
 * @param {string} newParentId - New parent ID for the task
 * @param {number} newPosition - New position among siblings
 * @param {string} oldParentId - Previous parent ID
 * @returns {Promise<{success: boolean, error: string}>} - Result of the operation
 */
const updateTaskAfterDragDrop = async (taskId, newParentId, newPosition, oldParentId) => {
  try {
    console.log(`Updating task after drag/drop: task=${taskId}, newParent=${newParentId}, newPos=${newPosition}`);
    
    // Step 1: Update the task's position and parent in the database
    const result = await updateTaskPosition(taskId, newParentId, newPosition);
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to update task position');
    }
    
    // Step 2: Fetch the updated tasks to ensure we have the latest state
    const { instanceTasks: updatedTasks } = await fetchTasks(true);
    
    // Step 3: Find the root project by traversing up the hierarchy
    const movedTask = updatedTasks.find(t => t.id === taskId);
    if (!movedTask) {
      throw new Error('Could not find the moved task');
    }
    
    // Function to find the root project of a task
    const findRootProject = (task, allTasks) => {
      if (!task.parent_task_id) {
        return task; // This is already a root task
      }
      
      const parent = allTasks.find(t => t.id === task.parent_task_id);
      if (!parent) {
        return task; // Parent not found, return current task
      }
      
      // Recursively find the root
      return findRootProject(parent, allTasks);
    };
    
    // Find the root project for this task
    const rootProject = findRootProject(movedTask, updatedTasks);
    
    if (!rootProject || !rootProject.start_date) {
      throw new Error('Could not find a valid root project with start date');
    }
    
    console.log(`Found root project: ${rootProject.id} (${rootProject.title})`);
    
    // Step 4: Get all tasks in this project's hierarchy
    const projectTasks = getAllTasksInHierarchy(rootProject.id, updatedTasks);
    
    console.log(`Found ${projectTasks.length} tasks in the project hierarchy`);
    
    // *** CONSOLIDATED DATE CALCULATIONS - delegate to dateUtils ***
    // Step 5: Use dateUtils to recalculate all dates in the hierarchy
    const tasksWithUpdatedDates = updateTaskDatesInHierarchy(
      rootProject.id,
      new Date(rootProject.start_date),
      projectTasks
    );
    
    console.log('Recalculated dates for entire hierarchy using dateUtils');
    
    // Step 6: Create update promises for each affected task
    const dateUpdatePromises = [];
    
    for (const updatedTask of tasksWithUpdatedDates) {
      // Find original task to check if dates changed
      const originalTask = updatedTasks.find(t => t.id === updatedTask.id);
      if (!originalTask) continue;
      
      // Only update if dates or durations changed
      if (originalTask.start_date !== updatedTask.start_date || 
          originalTask.due_date !== updatedTask.due_date ||
          originalTask.duration_days !== updatedTask.duration_days) {
        
        console.log(`Task ${updatedTask.id} (${updatedTask.title || 'unnamed'}) changes:`);
        console.log(` - Start: ${originalTask.start_date} → ${updatedTask.start_date}`);
        console.log(` - Due: ${originalTask.due_date} → ${updatedTask.due_date}`);
        console.log(` - Duration: ${originalTask.duration_days} → ${updatedTask.duration_days}`);
        
        // Calculate days from parent start using dateUtils if needed
        let daysFromStart = 0;
        if (updatedTask.parent_task_id) {
          const parent = tasksWithUpdatedDates.find(t => t.id === updatedTask.parent_task_id);
          if (parent && parent.start_date && updatedTask.start_date) {
            const parentStartDate = new Date(parent.start_date);
            const taskStartDate = new Date(updatedTask.start_date);
            daysFromStart = Math.max(0, Math.ceil((taskStartDate - parentStartDate) / (1000 * 60 * 60 * 24)));
          }
        }
        
        dateUpdatePromises.push(
          updateTaskDateFields(updatedTask.id, {
            start_date: updatedTask.start_date,
            due_date: updatedTask.due_date,
            duration_days: updatedTask.duration_days,
            days_from_start_until_due: daysFromStart
          })
        );
      }
    }
    
    // Step 7: Execute all update promises
    if (dateUpdatePromises.length > 0) {
      console.log(`Updating ${dateUpdatePromises.length} tasks after rearrangement`);
      await Promise.all(dateUpdatePromises);
      
      // Step 8: Update the UI immediately with the calculated dates
      // This creates a smoother experience without waiting for another fetch
      const updatedTasksForUI = updatedTasks.map(task => {
        const calculatedTask = tasksWithUpdatedDates.find(t => t.id === task.id);
        if (calculatedTask) {
          return {
            ...task,
            start_date: calculatedTask.start_date,
            due_date: calculatedTask.due_date,
            duration_days: calculatedTask.duration_days,
            days_from_start_until_due: calculatedTask.days_from_start_until_due
          };
        }
        return task;
      });
      
      // Update local state with calculated dates
      updateTasks(updatedTasksForUI, true);
    }
    
    // Step 9: Final refresh to ensure database and UI are in sync
    await fetchTasks(true);
    
    return { success: true };
  } catch (err) {
    console.error('Error updating tasks after drag/drop:', err);
    return { success: false, error: err.message };
  }
};
  
  // Initial fetch when component mounts
  useEffect(() => {
    if (userLoading || orgLoading) {
      return;
    }
    
    if (!initialFetchDoneRef.current && user?.id) {
      fetchTasks();
    }
  }, [user?.id, organizationId, userLoading, orgLoading, fetchTasks]);
  
  useEffect(() => {
    // Set the ref to true on mount
    isMountedRef.current = true;
    
    // Clean up function to set ref to false on unmount
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Create the context value
  const contextValue = {
    // Task management
    tasks,
    instanceTasks, // Now a derived value via useMemo
    templateTasks, // Now a derived value via useMemo
    loading,
    initialLoading,
    error,
    fetchTasks,
    setTasks: updateTasks,
    createTask: createNewTask,
    deleteTask: deleteTaskHandler,
    // Date-specific functions
    updateTaskDates,
    // Expose additional task service functions directly
    updateTaskPosition,
    updateSiblingPositions,
    updateTaskCompletion,
    updateTaskAfterDragDrop,
    
    // License system
    canCreateProject,
    projectLimitReason,
    userLicenses,
    selectedLicenseId,
    userHasProjects,
    isCheckingLicense,
    ...licenseActions,
    
    // getSelectedLicense,
    setTasks: updateTasks,
    createTask: createNewTask,
    deleteTask: deleteTaskHandler,
    updateTask: updateTaskHandler, 
    createProjectFromTemplate,
    determineTaskStartDate: (task) => determineTaskStartDate(task, tasks),
  };

  return (
    <TaskContext.Provider value={contextValue}>
      {children}
    </TaskContext.Provider>
  );
};

export default TaskContext;